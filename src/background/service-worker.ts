import { classifyAsset, isGenericMime, isPreviewableKind, sniffMimeFromBytes } from "../shared/classify";
import { buildExportPayload, bytesToDataUrl } from "../shared/exporters";
import { clearSession, db, getSnapshot, sessionIdForTab } from "../shared/db";
import type { PickerResult, RuntimeMessage, RuntimeResponse } from "../shared/messages";
import type { AssetRecord, BlobRecord, CaptureSource, MediaRecord, RequestEvent } from "../shared/types";
import { base64ToBytes, getExtension, inferFrameOrigin, stableId } from "../shared/url";

const requestStarts = new Map<string, number>();
const deepCaptureTabs = new Set<number>();
const pickerActiveTabs = new Set<number>();
const pendingPickerResults = new Map<number, PickerResult>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestStarts.set(details.requestId, details.timeStamp);
    void recordRequest(details, "beforeRequest");
    void upsertAssetFromRequest(details, "webRequest");
    return undefined;
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onSendHeaders.addListener(
  (details) => void recordRequest(details, "sendHeaders"),
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    void recordRequest(details, "headersReceived");
    void upsertAssetFromRequest(details, "webRequest");
    return undefined;
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    void recordRequest(details, "completed");
    void upsertAssetFromRequest(details, "webRequest");
    requestStarts.delete(details.requestId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    void recordRequest(details, "error");
    requestStarts.delete(details.requestId);
  },
  { urls: ["<all_urls>"] }
);

// A closed tab's capture is dead weight (and assetBodies can be many MB each),
// so reclaim its IndexedDB rows and in-memory state when the tab goes away.
chrome.tabs.onRemoved.addListener((tabId) => {
  deepCaptureTabs.delete(tabId);
  pickerActiveTabs.delete(tabId);
  pendingPickerResults.delete(tabId);
  void clearSession(tabId);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse: (response: RuntimeResponse) => void) => {
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown background error" });
    });
  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId || !method.startsWith("Network.")) return;
  const event = params as Record<string, unknown>;
  const url = extractDebuggerUrl(event);
  if (!url) return;
  void upsertAsset({
    sessionId: sessionIdForTab(source.tabId),
    tabId: source.tabId,
    url,
    method: typeof event.method === "string" ? event.method : undefined,
    status: typeof event.status === "number" ? event.status : undefined,
    mime: typeof event.mimeType === "string" ? event.mimeType : undefined,
    initiator: "Chrome Debugger Network domain",
    sources: ["devtools"]
  });
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) deepCaptureTabs.delete(source.tabId);
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<RuntimeResponse> {
  const requestedTabId = "tabId" in message ? message.tabId : undefined;
  const tabId = requestedTabId ?? sender.tab?.id ?? (await getActiveTabId());
  if (message.type === "GET_SNAPSHOT") {
    const snapshot = await getSnapshot(tabId);
    const pickerResult = tabId ? pendingPickerResults.get(tabId) : undefined;
    if (pickerResult && tabId) pendingPickerResults.delete(tabId);
    return {
      ok: true,
      snapshot: {
        ...snapshot,
        deepCaptureAttached: Boolean(tabId && deepCaptureTabs.has(tabId)),
        pickerActive: Boolean(tabId && pickerActiveTabs.has(tabId))
      },
      pickerResult
    };
  }

  if (message.type === "CLEAR_SESSION") {
    await clearSession(tabId);
    return { ok: true };
  }

  if (message.type === "DOM_ASSET_BATCH") {
    await Promise.all(message.assets.map((asset) => upsertAssetFromPartial(asset, tabId, sender.frameId, message.pageUrl)));
    await Promise.all((message.media ?? []).map((media) => upsertMedia(media, tabId, sender.frameId)));
    return { ok: true };
  }

  if (message.type === "PAGE_HOOK_EVENT") {
    await recordPageHookEvent(message, tabId, sender.frameId, message.pageUrl);
    return { ok: true };
  }

  if (message.type === "EXPORT") {
    const snapshot = await getSnapshot(tabId);
    // ZIP embeds bytes; prefer the bytes we already captured (works for blob:/
    // authenticated assets) over a credentialed re-fetch that could leak secrets.
    const bodies = message.exportType === "zip"
      ? new Map((await db.assetBodies.where("sessionId").equals(snapshot.sessionId).toArray()).map((body) => [body.assetId, { mime: body.mime, bytes: body.bytes }]))
      : undefined;
    const payload = await buildExportPayload(message.exportType, snapshot.sessionId, snapshot.assets, snapshot.requests, message.selectedIds, bodies);
    await db.exports.put(payload.job);
    const url = bytesToDataUrl(payload.bytes, payload.mime);
    await chrome.downloads.download({ url, filename: payload.filename, saveAs: true });
    return {
      ok: true,
      export: {
        job: payload.job,
        filename: payload.filename,
        mime: payload.mime,
        byteLength: payload.bytes.byteLength
      }
    };
  }

  if (message.type === "TOGGLE_DEEP_CAPTURE") {
    const attached = await setDeepCapture(message.tabId, message.enabled);
    return { ok: true, deepCaptureAttached: attached };
  }

  if (message.type === "ASSET_BODY") {
    await storeAssetBody(message, tabId);
    return { ok: true };
  }

  if (message.type === "GET_ASSET_BODY") {
    const record = await db.assetBodies.get(message.assetId);
    if (!record) return { ok: true, body: null };
    return { ok: true, body: { mime: record.mime, dataUrl: bytesToDataUrl(record.bytes, record.mime) } };
  }

  if (message.type === "DOWNLOAD_ASSET") {
    let url = message.url;
    if (message.assetId) {
      const body = await db.assetBodies.get(message.assetId);
      if (body) url = bytesToDataUrl(body.bytes, body.mime);
    }
    if (url.startsWith("blob:")) {
      return { ok: false, error: "This asset's bytes were not captured. Reload the page so it is captured, then download." };
    }
    const downloadId = await chrome.downloads.download({ url, filename: message.filename, saveAs: true });
    return { ok: true, downloadId };
  }

  if (message.type === "PICKER_ACTIVATE") {
    try {
      await chrome.tabs.sendMessage(message.tabId, { type: "PICKER_ACTIVATE" });
    } catch {
      // No content script on this tab (chrome://, Web Store, PDF viewer, etc.).
      pickerActiveTabs.delete(message.tabId);
      return { ok: false, error: "Element picker isn't available on this page." };
    }
    pickerActiveTabs.add(message.tabId);
    return { ok: true };
  }

  if (message.type === "PICKER_DEACTIVATE") {
    pickerActiveTabs.delete(message.tabId);
    if (message.tabId) pendingPickerResults.delete(message.tabId);
    try {
      await chrome.tabs.sendMessage(message.tabId, { type: "PICKER_DEACTIVATE" });
    } catch {
      // Tab has no content script; the in-memory state is already cleared.
    }
    return { ok: true };
  }

  if (message.type === "PICKER_RESULT") {
    const senderTabId = sender.tab?.id;
    if (senderTabId) {
      pickerActiveTabs.delete(senderTabId);
      pendingPickerResults.set(senderTabId, {
        assetUrl: message.assetUrl,
        cssSelector: message.cssSelector,
        pageUrl: message.pageUrl,
        timestamp: Date.now()
      });
    }
    return { ok: true };
  }

  if (message.type === "PICKER_CANCELLED") {
    const senderTabId = sender.tab?.id;
    if (senderTabId) pickerActiveTabs.delete(senderTabId);
    return { ok: true };
  }

  return { ok: false, error: "Unsupported message" };
}

async function recordPageHookEvent(message: Extract<RuntimeMessage, { type: "PAGE_HOOK_EVENT" }>, tabId?: number, frameId?: number, pageUrl?: string): Promise<void> {
  const sessionId = sessionIdForTab(tabId);
  const event = message.event;
  if (event.kind === "blob") {
    // An empty blobUrl has no correlation key; recording it would collide every
    // such event into one junk blob record and a blank-URL asset row.
    if (!event.blobUrl) return;
    const blob: BlobRecord = {
      id: `blob-${stableId(`${sessionId}:${event.blobUrl}`)}`,
      sessionId,
      tabId,
      frameId,
      blobUrl: event.blobUrl,
      mime: event.mime,
      size: event.size,
      producerApi: event.producerApi,
      stackTraceHash: event.stack ? stableId(event.stack) : undefined,
      createdAt: event.timestamp,
      previewStatus: "available"
    };
    await db.blobs.put(blob);
    await upsertAsset({
      sessionId,
      tabId,
      frameId,
      url: event.blobUrl,
      mime: event.mime,
      size: event.size,
      initiator: pageUrl,
      sources: ["blob"]
    });
    return;
  }

  if (event.kind === "blob-revoked") {
    const id = `blob-${stableId(`${sessionId}:${event.blobUrl}`)}`;
    const existing = await db.blobs.get(id);
    if (existing) await db.blobs.put({ ...existing, revokedAt: event.timestamp, previewStatus: "revoked" });
    return;
  }

  if (event.kind === "data-url") {
    await upsertAsset({
      sessionId,
      tabId,
      frameId,
      url: event.url,
      mime: event.mime,
      size: event.size,
      initiator: pageUrl,
      sources: ["data"]
    });
    return;
  }

  await upsertAsset({
    sessionId,
    tabId,
    frameId,
    url: event.url,
    method: event.method,
    status: event.status,
    mime: event.mime,
    size: event.size,
    initiator: pageUrl,
    sources: [event.kind]
  });
}

async function storeAssetBody(
  message: Extract<RuntimeMessage, { type: "ASSET_BODY" }>,
  tabId?: number
): Promise<void> {
  const sessionId = sessionIdForTab(tabId);
  const assetId = `asset-${stableId(`${sessionId}:${message.key}`)}`;
  const bytes = base64ToBytes(message.base64);
  // Intelligent detection: when the wire MIME is missing/generic, trust the
  // bytes. This rescues mislabeled assets (octet-stream images, extensionless
  // CDN/object-store URLs) that would otherwise be unclassified & unpreviewable.
  const sniffed = isGenericMime(message.mime) ? sniffMimeFromBytes(bytes.subarray(0, 64)) : undefined;
  const mime = sniffed ?? message.mime ?? "application/octet-stream";
  try {
    await db.assetBodies.put({ assetId, sessionId, mime, bytes, byteLength: bytes.byteLength, createdAt: Date.now() });
  } catch {
    // Quota or storage failure must not break capture; the asset stays metadata-only.
    return;
  }
  // Atomic flag flip + re-classification so a concurrent upsertAsset can't clobber
  // the merge, and so byte-derived knowledge upgrades a previously-binary asset.
  const updated = await db.assets.where("id").equals(assetId).modify((asset) => {
    asset.bodyAvailable = true;
    // A byte-sniffed MIME beats a stored generic one; otherwise fill if absent.
    if (sniffed && isGenericMime(asset.mime)) asset.mime = sniffed;
    else if (!asset.mime) asset.mime = mime;
    const kind = classifyAsset({ url: asset.url, mime: asset.mime, resourceType: asset.resourceType ?? asset.sources[0], sources: asset.sources });
    asset.kind = kind;
    asset.previewAvailable = isPreviewableKind(kind);
    asset.updatedAt = Date.now();
  });
  if (updated > 0) return;
  // Body may arrive before the metadata event; create the asset so it is visible.
  await upsertAsset({
    sessionId,
    tabId,
    url: message.key,
    mime,
    initiator: message.pageUrl,
    sources: message.key.startsWith("blob:") ? ["blob"] : ["fetch"],
    bodyAvailable: true
  });
}

async function recordRequest(
  details: AnyWebRequestDetails,
  phase: RequestEvent["phase"]
): Promise<void> {
  const sessionId = sessionIdForTab(details.tabId >= 0 ? details.tabId : undefined);
  const event: RequestEvent = {
    id: `${details.requestId}:${phase}:${Math.round(details.timeStamp)}`,
    requestId: details.requestId,
    sessionId,
    tabId: details.tabId >= 0 ? details.tabId : undefined,
    frameId: details.frameId,
    phase,
    url: details.url,
    method: "method" in details ? details.method : undefined,
    status: details.statusCode,
    requestHeaders: headerArrayToRecord(details.requestHeaders),
    responseHeaders: headerArrayToRecord(details.responseHeaders),
    mime: getHeader(details.responseHeaders, "content-type"),
    resourceType: "type" in details ? details.type : undefined,
    errorText: "error" in details ? details.error : undefined,
    initiator: "initiator" in details ? details.initiator : undefined,
    timestamp: details.timeStamp
  };
  await db.requests.put(event);
}

async function upsertAssetFromRequest(
  details: AnyWebRequestDetails,
  source: CaptureSource
): Promise<void> {
  const tabId = details.tabId >= 0 ? details.tabId : undefined;
  const startedAt = requestStarts.get(details.requestId);
  await upsertAsset({
    sessionId: sessionIdForTab(tabId),
    tabId,
    frameId: details.frameId,
    url: details.url,
    method: "method" in details ? details.method : undefined,
    status: details.statusCode,
    mime: getHeader(details.responseHeaders, "content-type"),
    size: numberHeader(details.responseHeaders, "content-length"),
    timing: {
      startedAt,
      completedAt: "timeStamp" in details ? details.timeStamp : undefined,
      durationMs: startedAt ? details.timeStamp - startedAt : undefined
    },
    resourceType: "type" in details ? details.type : undefined,
    initiator: "initiator" in details ? details.initiator : undefined,
    sources: [source]
  });
}

async function upsertAssetFromPartial(
  partial: Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">,
  tabId?: number,
  frameId?: number,
  pageUrl?: string
): Promise<void> {
  await upsertAsset({
    ...partial,
    sessionId: sessionIdForTab(tabId),
    tabId,
    frameId,
    initiator: partial.initiator ?? pageUrl
  });
}

async function upsertAsset(input: Partial<AssetRecord> & Pick<AssetRecord, "sessionId" | "url" | "sources"> & { resourceType?: string }): Promise<AssetRecord> {
  const now = Date.now();
  const id = input.id ?? `asset-${stableId(`${input.sessionId}:${input.url}`)}`;
  // Many capture sources (webRequest phases, DOM scan, page hooks) upsert the
  // same id concurrently; an unguarded get+put interleaves and silently drops
  // merged sources/timing. The read-modify-write must run in one rw transaction.
  return db.transaction("rw", db.assets, async () => {
    const existing = await db.assets.get(id);
    const resourceType = input.resourceType ?? existing?.resourceType;
    // Prefer the real webRequest resourceType (image/media/font/xmlhttprequest/…)
    // over the capture-source label so the classifier's resourceType branches fire.
    const kind = input.kind ?? classifyAsset({ url: input.url, mime: input.mime, resourceType: resourceType ?? input.sources[0], sources: input.sources });
    const mergedSources = Array.from(new Set([...(existing?.sources ?? []), ...input.sources]));
    const record: AssetRecord = {
      id,
      sessionId: input.sessionId,
      tabId: input.tabId ?? existing?.tabId,
      frameId: input.frameId ?? existing?.frameId,
      url: input.url,
      originalUrl: input.originalUrl ?? existing?.originalUrl,
      kind,
      mime: input.mime ?? existing?.mime,
      extension: input.extension ?? existing?.extension ?? getExtension(input.url),
      method: input.method ?? existing?.method,
      status: input.status ?? existing?.status,
      size: input.size ?? existing?.size,
      timing: { ...existing?.timing, ...input.timing },
      resourceType,
      initiator: input.initiator ?? existing?.initiator,
      frameOrigin: input.frameOrigin ?? existing?.frameOrigin ?? inferFrameOrigin(input.initiator),
      sources: mergedSources,
      domReferences: Array.from(new Set([...(existing?.domReferences ?? []), ...(input.domReferences ?? [])])),
      previewAvailable: input.previewAvailable ?? existing?.previewAvailable ?? isPreviewableKind(kind),
      bodyAvailable: input.bodyAvailable ?? existing?.bodyAvailable,
      redactionFlags: Array.from(new Set([...(existing?.redactionFlags ?? []), ...(input.redactionFlags ?? [])])),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await db.assets.put(record);
    return record;
  });
}

async function upsertMedia(partial: Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">, tabId?: number, frameId?: number): Promise<void> {
  const sessionId = sessionIdForTab(tabId);
  const media: MediaRecord = {
    id: partial.id ?? `media-${stableId(`${sessionId}:${partial.manifestUrl}`)}`,
    sessionId,
    tabId,
    frameId,
    manifestUrl: partial.manifestUrl,
    mediaKind: partial.mediaKind,
    playlistType: partial.playlistType,
    variants: partial.variants,
    segmentsSeen: partial.segmentsSeen,
    codecs: partial.codecs,
    resolutions: partial.resolutions,
    drmDetected: partial.drmDetected,
    nonDownloadableReason: partial.nonDownloadableReason,
    createdAt: partial.createdAt ?? Date.now()
  };
  await db.media.put(media);
}

async function setDeepCapture(tabId: number, enabled: boolean): Promise<boolean> {
  const debuggee = { tabId };
  if (!enabled) {
    if (deepCaptureTabs.has(tabId)) await chrome.debugger.detach(debuggee);
    deepCaptureTabs.delete(tabId);
    return false;
  }

  if (!deepCaptureTabs.has(tabId)) {
    await chrome.debugger.attach(debuggee, "1.3");
    await chrome.debugger.sendCommand(debuggee, "Network.enable");
    deepCaptureTabs.add(tabId);
  }
  return true;
}

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function headerArrayToRecord(headers?: chrome.webRequest.HttpHeader[]): Record<string, string> | undefined {
  if (!headers?.length) return undefined;
  const output: Record<string, string> = {};
  for (const header of headers) output[header.name] = header.value ?? "";
  return output;
}

interface AnyWebRequestDetails {
  requestId: string;
  url: string;
  tabId: number;
  frameId: number;
  timeStamp: number;
  method?: string;
  type?: string;
  requestHeaders?: chrome.webRequest.HttpHeader[];
  responseHeaders?: chrome.webRequest.HttpHeader[];
  statusCode?: number;
  error?: string;
  initiator?: string;
}

function getHeader(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function numberHeader(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): number | undefined {
  const value = getHeader(headers, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractDebuggerUrl(event: Record<string, unknown>): string | undefined {
  const request = event.request as Record<string, unknown> | undefined;
  const response = event.response as Record<string, unknown> | undefined;
  if (typeof request?.url === "string") return request.url;
  if (typeof response?.url === "string") return response.url;
  if (typeof event.documentURL === "string") return event.documentURL;
  return undefined;
}
