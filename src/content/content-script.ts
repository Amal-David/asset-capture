import type { PageHookEvent, RuntimeMessage } from "../shared/messages";
import { bytesToBase64, normalizeUrl } from "../shared/url";
import type { AssetRecord, CaptureSource, MediaRecord } from "../shared/types";
import { cssSelector, extractCssUrls, parseSrcset } from "./asset-detection";
import { activatePicker, deactivatePicker } from "./element-picker";

type AssetDraft = Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">;
type MediaDraft = Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">;
type WithShadow = Element & { shadowRoot: ShadowRoot | null };

const ASSET_SELECTOR = "img, source, video, audio, track, script, link, iframe, embed, object, image, use";
const SCAN_DEBOUNCE_MS = 250;
// Lazyload libraries (lazysizes, lozad, WordPress, Shopify) stash the real URL
// in data-* until scroll; reading these up front captures below-the-fold imagery
// that the user never scrolls to.
const URL_ATTRS = ["src", "href", "poster", "data", "data-src", "data-lazy", "data-lazy-src", "data-original", "data-bg", "data-background", "data-poster", "data-thumb", "data-image"];
const SRCSET_ATTRS = ["srcset", "imagesrcset", "data-srcset", "data-lazy-srcset"];
const OBSERVED_ATTRS = ["src", "srcset", "href", "poster", "style", "data-src", "data-srcset", "data-lazy", "data-lazy-src", "data-original", "data-bg", "data-background", "data-poster"];
const CSS_URL_PROPS = ["background-image", "background", "border-image-source", "border-image", "mask-image", "-webkit-mask-image", "list-style-image", "cursor", "content"];
const XLINK = "http://www.w3.org/1999/xlink";

let scanTimer: number | undefined;
let flushTimer: number | undefined;
let styleDirty = true;
let lastScannedUrl = location.href;
const dirtyElements = new Set<Element>();
// Tracked in a real Set (not WeakSet) so we can prune detached roots: a
// MutationObserver strongly pins every observed node, so without pruning,
// component-churning SPAs would leak every shadow root ever seen.
const observedRoots = new Set<ShadowRoot>();

const observer = new MutationObserver(handleMutations);

// page-hooks now runs as a MAIN-world content script at document_start (manifest),
// so it patches page APIs before parse-time scripts — no manual injection needed.
scheduleScan();
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
installSpaRescan();

function handleMutations(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type === "childList") {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches("style, link") || node.querySelector?.("style, link")) styleDirty = true;
        markDirtyTree(node);
      });
    } else if (record.type === "attributes" && record.target instanceof Element) {
      // Inline-style animation churn carries no new url(); ignore those.
      if (record.attributeName === "style" && !(record.target.getAttribute("style") ?? "").includes("url(")) continue;
      dirtyElements.add(record.target);
    }
  }
  if (dirtyElements.size || styleDirty) scheduleFlush();
}

// Recurse the element tree AND every (open, or force-opened) shadow root so
// web-component imagery/fonts/sprites inside shadow DOM are captured too.
function forEachElementDeep(root: ParentNode, visit: (el: Element) => void): void {
  const elements = root.querySelectorAll<Element>("*");
  for (const el of elements) {
    visit(el);
    const shadow = (el as WithShadow).shadowRoot;
    if (shadow) {
      observeShadowRoot(shadow);
      forEachElementDeep(shadow, visit);
    }
  }
}

function observeShadowRoot(root: ShadowRoot): void {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
}

function markDirtyTree(root: Element): void {
  if (root.matches(ASSET_SELECTOR) || root.hasAttribute("style")) dirtyElements.add(root);
  const ownShadow = (root as WithShadow).shadowRoot;
  if (ownShadow) { observeShadowRoot(ownShadow); forEachElementDeep(ownShadow, markDirty); }
  forEachElementDeep(root, markDirty);
}

function markDirty(el: Element): void {
  if (el.matches(ASSET_SELECTOR) || el.hasAttribute("style")) dirtyElements.add(el);
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scanDom, SCAN_DEBOUNCE_MS);
}

function scheduleFlush(): void {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flushDirty, SCAN_DEBOUNCE_MS);
}

function scanDom(): void {
  const assets: AssetDraft[] = [];
  const media: MediaDraft[] = [];
  const adopted: CSSStyleSheet[] = [];

  forEachElementDeep(document, (el) => {
    if (el.matches(ASSET_SELECTOR)) collectElementAssets(el, assets, media);
    const style = el.getAttribute("style");
    if (style && style.includes("url(")) {
      for (const url of extractCssUrls(style, location.href)) assets.push(assetFromUrl(url, "css", cssSelector(el)));
    }
    const shadow = (el as WithShadow).shadowRoot;
    if (shadow?.adoptedStyleSheets?.length) adopted.push(...shadow.adoptedStyleSheets);
  });

  scanStylesheets(assets, adopted);
  styleDirty = false;
  reobserveLiveRoots();
  sendAssetBatch(dedupeAssets(assets), dedupeMedia(media));
}

// Drop observation of shadow roots whose host has been removed, so the observer
// stops pinning detached subtrees. Cheap because it only runs on full scans.
function reobserveLiveRoots(): void {
  let pruned = false;
  for (const root of observedRoots) {
    if (!root.host?.isConnected) { observedRoots.delete(root); pruned = true; }
  }
  if (!pruned) return;
  observer.disconnect();
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
  for (const root of observedRoots) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
}

function flushDirty(): void {
  const elements = Array.from(dirtyElements);
  dirtyElements.clear();
  const assets: AssetDraft[] = [];
  const media: MediaDraft[] = [];

  for (const element of elements) {
    if (!element.isConnected) continue;
    if (element.matches(ASSET_SELECTOR)) collectElementAssets(element, assets, media);
    const style = element.getAttribute("style");
    if (style && style.includes("url(")) {
      for (const url of extractCssUrls(style, location.href)) assets.push(assetFromUrl(url, "css", cssSelector(element)));
    }
  }
  // Re-sweep stylesheets only when one was added/changed (cheap gate).
  if (styleDirty) { scanStylesheets(assets, []); styleDirty = false; }

  sendAssetBatch(dedupeAssets(assets), dedupeMedia(media));
}

// Walk document + adopted (constructable) stylesheets for url()-bearing rules,
// @font-face src, and @import — the dominant way real sites deliver background
// images and fonts, none of which appear as a literal style="" attribute.
function scanStylesheets(assets: AssetDraft[], extraSheets: CSSStyleSheet[]): void {
  const sheets: CSSStyleSheet[] = [];
  try { sheets.push(...(Array.from(document.styleSheets) as CSSStyleSheet[])); } catch { /* ignore */ }
  try { sheets.push(...((document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [])); } catch { /* ignore */ }
  sheets.push(...extraSheets);
  for (const sheet of sheets) collectSheetUrls(sheet, assets);
}

function collectSheetUrls(sheet: CSSStyleSheet, assets: AssetDraft[]): void {
  let rules: CSSRuleList | undefined;
  try { rules = sheet.cssRules; } catch { return; } // cross-origin sheets throw SecurityError
  if (!rules) return;
  const base = sheet.href ?? location.href;
  for (const rule of Array.from(rules)) collectRuleUrls(rule, base, assets);
}

function collectRuleUrls(rule: CSSRule, base: string, assets: AssetDraft[]): void {
  if (rule instanceof CSSStyleRule) {
    for (const prop of CSS_URL_PROPS) {
      const value = rule.style.getPropertyValue(prop);
      if (value && value.includes("url(")) {
        for (const url of extractCssUrls(value, base)) assets.push(assetFromUrl(url, "css"));
      }
    }
  } else if (rule instanceof CSSImportRule) {
    if (rule.href) assets.push(assetFromUrl(normalizeUrl(rule.href, base), "css"));
    if (rule.styleSheet) collectSheetUrls(rule.styleSheet, assets);
  } else if (typeof CSSFontFaceRule !== "undefined" && rule instanceof CSSFontFaceRule) {
    const src = rule.style.getPropertyValue("src");
    if (src) for (const url of extractCssUrls(src, base)) assets.push({ ...assetFromUrl(url, "css"), kind: "font" });
  } else if ("cssRules" in rule) {
    try {
      for (const child of Array.from((rule as CSSGroupingRule).cssRules)) collectRuleUrls(child, base, assets);
    } catch { /* ignore */ }
  }
}

function collectElementAssets(element: Element, assets: AssetDraft[], media: MediaDraft[]): void {
  const selector = cssSelector(element);
  const urls = new Set<string>();
  for (const attr of URL_ATTRS) {
    const value = element.getAttribute(attr);
    if (value) urls.add(value);
  }
  for (const attr of SRCSET_ATTRS) {
    const srcset = element.getAttribute(attr);
    if (srcset) parseSrcset(srcset).forEach((url) => urls.add(url));
  }
  // SVG <image>/<use> use href / xlink:href; <use href="#local"> is same-doc only.
  const tag = element.tagName.toLowerCase();
  if (tag === "image" || tag === "use") {
    const href = element.getAttribute("href") || element.getAttributeNS(XLINK, "href");
    if (href) urls.add(tag === "use" ? href.split("#")[0]! : href);
  }

  for (const rawUrl of urls) {
    if (!rawUrl || rawUrl.startsWith("#")) continue;
    const url = normalizeUrl(rawUrl, location.href);
    const sources: CaptureSource[] = url.startsWith("blob:") ? ["dom", "blob"] : url.startsWith("data:") ? ["dom", "data"] : ["dom"];
    const asset = assetFromUrl(url, sources[0]!, selector);
    asset.sources = sources;
    if (element instanceof HTMLMediaElement || tag === "source") asset.sources = Array.from(new Set([...sources, "media"]));
    assets.push(asset);
    maybeMediaRecord(url, media);
  }
}

// Re-scan on SPA navigations (no document reload) plus a couple of backed-off
// safety passes, so routes entered after the panel opened still get captured.
function installSpaRescan(): void {
  const onNav = () => {
    if (location.href === lastScannedUrl) return;
    lastScannedUrl = location.href;
    styleDirty = true;
    scheduleScan();
  };
  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);
  window.addEventListener("locationchange", onNav); // dispatched by the page hook's history patch
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleScan(); });
  for (const delay of [1500, 4000, 8000]) window.setTimeout(() => { styleDirty = true; scheduleScan(); }, delay);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; payload?: unknown };
  if (data?.source === "asset-inspector-page-hook" && data.payload) {
    void chrome.runtime.sendMessage({
      type: "PAGE_HOOK_EVENT",
      event: data.payload as PageHookEvent,
      pageUrl: location.href
    } satisfies RuntimeMessage);
    return;
  }
  if (data?.source === "asset-inspector-page-hook-body" && data.payload) {
    const body = data.payload as { key?: string; mime?: string; buffer?: ArrayBuffer };
    if (!body.key || !body.buffer) return;
    void chrome.runtime.sendMessage({
      type: "ASSET_BODY",
      key: body.key,
      mime: body.mime,
      base64: bytesToBase64(new Uint8Array(body.buffer)),
      pageUrl: location.href
    } satisfies RuntimeMessage);
  }
});

chrome.runtime.onMessage.addListener((message: { type: string }, _sender, sendResponse) => {
  if (message.type === "PICKER_ACTIVATE" && window === window.top) {
    activatePicker();
    sendResponse({ ok: true });
  } else if (message.type === "PICKER_DEACTIVATE") {
    deactivatePicker();
    sendResponse({ ok: true });
  } else if (message.type === "PAGE_RESCAN") {
    styleDirty = true;
    scanDom();
    sendResponse({ ok: true });
  }
  return false;
});

if ("PerformanceObserver" in window) {
  try {
    const perfObserver = new PerformanceObserver((list) => {
      const assets = list
        .getEntriesByType("resource")
        .map((entry) => assetFromPerformanceEntry(entry as PerformanceResourceTiming))
        .filter((asset): asset is AssetDraft => Boolean(asset));
      if (assets.length) sendAssetBatch(assets);
    });
    perfObserver.observe({ entryTypes: ["resource"] });
  } catch {
    // Some pages disable resource timing observation; DOM and webRequest capture still continue.
  }
}

function assetFromPerformanceEntry(entry: PerformanceResourceTiming): AssetDraft | undefined {
  if (!entry.name) return undefined;
  return {
    // No id: the service worker derives the canonical id from sessionId:url so
    // DOM/performance and network captures merge.
    url: normalizeUrl(entry.name, location.href),
    sources: ["performance"],
    size: entry.transferSize || entry.encodedBodySize || undefined,
    timing: {
      startedAt: entry.startTime ? performance.timeOrigin + entry.startTime : undefined,
      completedAt: performance.timeOrigin + entry.responseEnd,
      durationMs: entry.duration
    },
    initiator: entry.initiatorType
  };
}

function assetFromUrl(url: string, source: CaptureSource, selector?: string): AssetDraft {
  return {
    url,
    sources: [source],
    domReferences: selector ? [selector] : undefined,
    initiator: location.href
  };
}

function maybeMediaRecord(url: string, media: MediaDraft[]): void {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".m3u8")) media.push({ manifestUrl: url, mediaKind: "hls" });
  if (lower.endsWith(".mpd")) media.push({ manifestUrl: url, mediaKind: "dash" });
}

function sendAssetBatch(assets: AssetDraft[], media: MediaDraft[] = []): void {
  if (!assets.length && !media.length) return;
  void chrome.runtime.sendMessage({
    type: "DOM_ASSET_BATCH",
    assets,
    media,
    pageUrl: location.href
  } satisfies RuntimeMessage);
}

function dedupeAssets(assets: AssetDraft[]): AssetDraft[] {
  const byUrl = new Map<string, AssetDraft>();
  for (const asset of assets) {
    const existing = byUrl.get(asset.url);
    if (!existing) {
      byUrl.set(asset.url, asset);
      continue;
    }
    existing.sources = Array.from(new Set([...existing.sources, ...asset.sources]));
    existing.domReferences = Array.from(new Set([...(existing.domReferences ?? []), ...(asset.domReferences ?? [])]));
    if (!existing.kind && asset.kind) existing.kind = asset.kind;
  }
  return Array.from(byUrl.values());
}

function dedupeMedia(media: MediaDraft[]): MediaDraft[] {
  return Array.from(new Map(media.map((record) => [record.manifestUrl, record])).values());
}
