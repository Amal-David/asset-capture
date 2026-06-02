import type { PageHookEvent, RuntimeMessage } from "../shared/messages";
import { bytesToBase64, normalizeUrl } from "../shared/url";
import type { AssetRecord, CaptureSource, MediaRecord } from "../shared/types";
import { cssSelector, extractCssUrls, parseSrcset } from "./asset-detection";
import { activatePicker, deactivatePicker } from "./element-picker";

const ASSET_SELECTOR = "img, source, video, audio, track, script, link, iframe, embed, object";
const SCAN_DEBOUNCE_MS = 250;
let scanTimer: number | undefined;

// Only elements that were actually added or mutated need rescanning. A full
// document re-query per mutation is sustained CPU on SPAs/animated pages.
const dirtyElements = new Set<Element>();
let flushTimer: number | undefined;

injectPageHooks();
scheduleScan();

const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "childList") {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) markDirtyTree(node);
      });
    } else if (record.type === "attributes" && record.target instanceof Element) {
      // Inline-style animations churn the style attribute constantly; only a
      // value carrying a url() can introduce a new asset, so ignore the rest.
      if (record.attributeName === "style" && !(record.target.getAttribute("style") ?? "").includes("url(")) continue;
      dirtyElements.add(record.target);
    }
  }
  if (dirtyElements.size) scheduleFlush();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src", "srcset", "href", "poster", "style"]
});

function markDirtyTree(root: Element): void {
  if (root.matches(ASSET_SELECTOR) || root.hasAttribute("style")) dirtyElements.add(root);
  for (const element of root.querySelectorAll(`${ASSET_SELECTOR}, [style]`)) dirtyElements.add(element);
}

function scheduleFlush(): void {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flushDirty, SCAN_DEBOUNCE_MS);
}

function flushDirty(): void {
  if (!dirtyElements.size) return;
  const elements = Array.from(dirtyElements);
  dirtyElements.clear();

  const assets: Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">> = [];
  const media: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">> = [];
  for (const element of elements) {
    if (!element.isConnected) continue;
    if (element.matches(ASSET_SELECTOR)) collectElementAssets(element, assets, media);
    if (element.hasAttribute("style")) {
      for (const url of extractCssUrls(element.getAttribute("style") ?? "", location.href)) {
        assets.push(assetFromUrl(url, "dom", cssSelector(element)));
      }
    }
  }
  sendAssetBatch(dedupeAssets(assets), dedupeMedia(media));
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
  }
  return false;
});

if ("PerformanceObserver" in window) {
  try {
    const perfObserver = new PerformanceObserver((list) => {
      const assets = list
        .getEntriesByType("resource")
        .map((entry) => assetFromPerformanceEntry(entry as PerformanceResourceTiming))
        .filter((asset): asset is Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources"> => Boolean(asset));
      if (assets.length) sendAssetBatch(assets);
    });
    perfObserver.observe({ entryTypes: ["resource"] });
  } catch {
    // Some pages disable resource timing observation; DOM and webRequest capture still continue.
  }
}

function injectPageHooks(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/content/page-hooks.ts");
  script.async = false;
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scanDom, SCAN_DEBOUNCE_MS);
}

function scanDom(): void {
  const assets: Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">> = [];
  const media: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">> = [];

  for (const element of Array.from(document.querySelectorAll(ASSET_SELECTOR))) {
    collectElementAssets(element, assets, media);
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[style]"))) {
    for (const url of extractCssUrls(element.getAttribute("style") ?? "", location.href)) {
      assets.push(assetFromUrl(url, "dom", cssSelector(element)));
    }
  }

  sendAssetBatch(dedupeAssets(assets), dedupeMedia(media));
}

function collectElementAssets(
  element: Element,
  assets: Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">>,
  media: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">>
): void {
  const selector = cssSelector(element);
  const urls = new Set<string>();
  for (const attr of ["src", "href", "poster", "data"]) {
    const value = element.getAttribute(attr);
    if (value) urls.add(value);
  }
  for (const attr of ["srcset", "imagesrcset"]) {
    const srcset = element.getAttribute(attr);
    if (srcset) parseSrcset(srcset).forEach((url) => urls.add(url));
  }

  for (const rawUrl of urls) {
    const url = normalizeUrl(rawUrl, location.href);
    const sources: CaptureSource[] = url.startsWith("blob:") ? ["dom", "blob"] : url.startsWith("data:") ? ["dom", "data"] : ["dom"];
    const asset = assetFromUrl(url, sources[0], selector);
    asset.sources = sources;
    if (element instanceof HTMLMediaElement || element.tagName.toLowerCase() === "source") asset.sources = Array.from(new Set([...sources, "media"]));
    assets.push(asset);
    maybeMediaRecord(url, media);
  }
}

function assetFromPerformanceEntry(entry: PerformanceResourceTiming): (Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">) | undefined {
  if (!entry.name) return undefined;
  return {
    // No id here: the service worker derives the canonical asset id from
    // sessionId(`tab-<id>`):url so DOM/performance and network captures merge.
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

function assetFromUrl(url: string, source: CaptureSource, selector?: string): Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources"> {
  return {
    // No id: the service worker keys assets by sessionId:url (see above), so
    // leaving it unset lets DOM-scanned assets merge with webRequest/body records.
    url,
    sources: [source],
    domReferences: selector ? [selector] : undefined,
    initiator: location.href
  };
}

function maybeMediaRecord(url: string, media: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">>): void {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (lower.endsWith(".m3u8")) media.push({ manifestUrl: url, mediaKind: "hls" });
  if (lower.endsWith(".mpd")) media.push({ manifestUrl: url, mediaKind: "dash" });
}

function sendAssetBatch(
  assets: Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">>,
  media: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">> = []
): void {
  if (!assets.length && !media.length) return;
  void chrome.runtime.sendMessage({
    type: "DOM_ASSET_BATCH",
    assets,
    media,
    pageUrl: location.href
  } satisfies RuntimeMessage);
}


function dedupeAssets(
  assets: Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">>
): Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">> {
  const byUrl = new Map<string, Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">>();
  for (const asset of assets) {
    const existing = byUrl.get(asset.url);
    if (!existing) {
      byUrl.set(asset.url, asset);
      continue;
    }
    existing.sources = Array.from(new Set([...existing.sources, ...asset.sources]));
    existing.domReferences = Array.from(new Set([...(existing.domReferences ?? []), ...(asset.domReferences ?? [])]));
  }
  return Array.from(byUrl.values());
}

function dedupeMedia(
  media: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">>
): Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">> {
  return Array.from(new Map(media.map((record) => [record.manifestUrl, record])).values());
}

