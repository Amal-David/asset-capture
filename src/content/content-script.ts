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
// Social/preview imagery referenced only from <meta> tags (never fetched by the
// page itself) — og:image and friends are real page assets users want to grab.
const META_ASSET_SELECTOR = 'meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[name="twitter:player:stream"], meta[itemprop="image"]';
const XLINK = "http://www.w3.org/1999/xlink";
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_HOOK_URL_CHARS = 8192;

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

// Recurse the element tree and every available shadow root. Closed roots stay
// closed unless the inspected tab has explicitly enabled deep capture.
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

  for (const meta of document.querySelectorAll(META_ASSET_SELECTOR)) {
    const content = meta.getAttribute("content");
    if (content) assets.push(assetFromUrl(normalizeUrl(content, location.href), "dom", cssSelector(meta)));
  }

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
  // Drain queued mutations before disconnect so SPA changes aren't lost in the gap.
  const pending = observer.takeRecords();
  observer.disconnect();
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
  for (const root of observedRoots) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: OBSERVED_ATTRS });
  if (pending.length) handleMutations(pending);
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
    // Scan the full rule text rather than a property allowlist: url() can live in
    // custom properties (--bg: url(...)), masks, shape-outside, cursor fallbacks —
    // any property, present or future.
    const text = rule.cssText;
    if (text.includes("url(") || text.includes("image-set(")) {
      for (const url of extractCssUrls(text, base)) assets.push(assetFromUrl(url, "css"));
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

// The background drops capture while the tab isn't being inspected, so hook
// events that fire before the panel opens would be lost forever (blob:/data:
// URLs especially have no other discovery path). Keep a bounded ring of recent
// metadata events and replay it when inspection starts.
const MAX_HOOK_REPLAY = 1000;
const hookReplayEvents: PageHookEvent[] = [];
let hookReplayCursor = 0;

function rememberHookEvent(event: PageHookEvent): void {
  if (hookReplayEvents.length < MAX_HOOK_REPLAY) {
    hookReplayEvents.push(event);
    return;
  }
  hookReplayEvents[hookReplayCursor] = event;
  hookReplayCursor = (hookReplayCursor + 1) % MAX_HOOK_REPLAY;
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; payload?: unknown };
  if (data?.source === "asset-inspector-page-hook" && data.payload) {
    if (!isPageHookEvent(data.payload)) return;
    // CSSOM mutation signal: the page injected/replaced stylesheet rules with no
    // DOM mutation. Re-scan stylesheets locally; nothing to record in the background.
    if (data.payload.kind === "cssom") {
      styleDirty = true;
      scheduleFlush();
      return;
    }
    rememberHookEvent(data.payload);
    void chrome.runtime.sendMessage({
      type: "PAGE_HOOK_EVENT",
      event: data.payload,
      pageUrl: location.href
    } satisfies RuntimeMessage);
    return;
  }
  if (data?.source === "asset-inspector-page-hook-body" && data.payload) {
    const body = data.payload as { key?: string; mime?: string; buffer?: ArrayBuffer };
    if (
      typeof body.key !== "string" ||
      body.key.length > MAX_HOOK_URL_CHARS ||
      body.mime !== undefined && typeof body.mime !== "string" ||
      !(body.buffer instanceof ArrayBuffer) ||
      body.buffer.byteLength === 0 ||
      body.buffer.byteLength > MAX_BODY_BYTES
    ) return;
    void chrome.runtime.sendMessage({
      type: "ASSET_BODY",
      key: body.key,
      mime: body.mime,
      base64: bytesToBase64(new Uint8Array(body.buffer)),
      pageUrl: location.href
    } satisfies RuntimeMessage);
  }
});

function isPageHookEvent(value: unknown): value is PageHookEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<PageHookEvent> & Record<string, unknown>;
  if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) return false;
  if (event.mime !== undefined && typeof event.mime !== "string") return false;
  if (event.size !== undefined && (typeof event.size !== "number" || !Number.isFinite(event.size) || event.size < 0)) return false;

  if (event.kind === "blob") {
    return (
      typeof event.blobUrl === "string" &&
      event.blobUrl.length > 0 &&
      event.blobUrl.length <= MAX_HOOK_URL_CHARS &&
      typeof event.producerApi === "string" &&
      (event.stack === undefined || typeof event.stack === "string") &&
      (event.hintKind === undefined || isAssetKind(event.hintKind))
    );
  }
  if (event.kind === "blob-revoked") {
    return typeof event.blobUrl === "string" && event.blobUrl.length > 0 && event.blobUrl.length <= MAX_HOOK_URL_CHARS;
  }
  if (event.kind === "data-url") {
    return typeof event.url === "string" && event.url.length > 0 && event.url.length <= MAX_HOOK_URL_CHARS && typeof event.producerApi === "string";
  }
  if (event.kind === "resource") {
    return (
      typeof event.url === "string" &&
      event.url.length > 0 &&
      event.url.length <= MAX_HOOK_URL_CHARS &&
      typeof event.producerApi === "string" &&
      (event.hintKind === undefined || isAssetKind(event.hintKind))
    );
  }
  if (event.kind === "cssom") {
    return true;
  }
  if (event.kind === "fetch" || event.kind === "xhr") {
    return (
      typeof event.url === "string" &&
      event.url.length > 0 &&
      event.url.length <= MAX_HOOK_URL_CHARS &&
      (event.method === undefined || typeof event.method === "string") &&
      (event.status === undefined || typeof event.status === "number")
    );
  }
  return false;
}

function isAssetKind(value: unknown): value is AssetRecord["kind"] {
  return (
    value === "image" || value === "video" || value === "audio" || value === "font" ||
    value === "json" || value === "api" || value === "css" || value === "script" ||
    value === "wasm" || value === "archive" || value === "model" || value === "subtitle" ||
    value === "manifest" || value === "document" || value === "binary" || value === "unknown"
  );
}

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
    replayCapturedHistory();
    sendResponse({ ok: true });
  }
  return false;
});

// Replay everything this frame saw before inspection started: the full resource
// timing history (network metadata) plus the buffered page-hook events. Upserts
// are idempotent (assets key on sessionId:url), so repeated rescans just re-merge.
function replayCapturedHistory(): void {
  const drafts: AssetDraft[] = [...overflowResourceDrafts];
  try {
    for (const entry of performance.getEntriesByType("resource")) {
      const draft = assetFromPerformanceEntry(entry as PerformanceResourceTiming);
      if (draft) drafts.push(draft);
    }
  } catch {
    // Resource timing may be unavailable; hook replay still runs.
  }
  const deduped = dedupeAssets(drafts);
  for (let index = 0; index < deduped.length; index += 500) {
    sendAssetBatch(deduped.slice(index, index + 500));
  }
  for (const event of hookReplayEvents) {
    void chrome.runtime.sendMessage({
      type: "PAGE_HOOK_EVENT",
      event,
      pageUrl: location.href
    } satisfies RuntimeMessage);
  }
}

// Raise the resource-timing buffer (default 250) so long-lived pages keep their
// full network history available for replay; when it still fills, preserve the
// entries (bounded) before clearing so nothing is lost.
const overflowResourceDrafts: AssetDraft[] = [];
const MAX_OVERFLOW_DRAFTS = 20_000;
try {
  performance.setResourceTimingBufferSize(10_000);
  performance.addEventListener("resourcetimingbufferfull", () => {
    if (overflowResourceDrafts.length < MAX_OVERFLOW_DRAFTS) {
      for (const entry of performance.getEntriesByType("resource")) {
        const draft = assetFromPerformanceEntry(entry as PerformanceResourceTiming);
        if (draft) overflowResourceDrafts.push(draft);
      }
    }
    performance.clearResourceTimings();
  });
} catch {
  // Best-effort: live PerformanceObserver capture below still works.
}

if ("PerformanceObserver" in window) {
  try {
    const perfObserver = new PerformanceObserver((list) => {
      const assets = list
        .getEntriesByType("resource")
        .map((entry) => assetFromPerformanceEntry(entry as PerformanceResourceTiming))
        .filter((asset): asset is AssetDraft => Boolean(asset));
      if (assets.length) sendAssetBatch(assets);
    });
    // buffered: also deliver entries recorded before this observer registered.
    perfObserver.observe({ type: "resource", buffered: true });
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
