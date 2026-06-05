(() => {
  // Bytes are captured non-destructively (clones / immutable blobs) so dynamic
  // and API-rendered assets stay previewable and downloadable after their URL
  // goes stale. Reads stay off the synchronous return path and are size-capped.
  const MAX_BODY_BYTES = 16 * 1024 * 1024;

  // "/" restricts delivery to this same window's origin (and handles opaque
  // origins), so captured bytes aren't broadcast to cross-origin frames.
  const post = (payload: unknown) => {
    window.postMessage({ source: "asset-inspector-page-hook", payload }, "/");
  };

  const postBody = (key: string, mime: string | undefined, buffer: ArrayBuffer | undefined) => {
    if (!key || !buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_BODY_BYTES) return;
    window.postMessage({ source: "asset-inspector-page-hook-body", payload: { key, mime, buffer } }, "/");
  };

  const captureBlobBody = (key: string, blob: Blob) => {
    if (blob.size > MAX_BODY_BYTES) return;
    void blob.arrayBuffer().then((buffer) => postBody(key, blob.type || undefined, buffer)).catch(() => undefined);
  };

  const textToBuffer = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;

  // Read a response body incrementally and abort the moment it exceeds the cap, so
  // an unbounded/chunked stream (NDJSON, log tail, streamed export) can't buffer the
  // whole thing into memory via clone().arrayBuffer() before the size check.
  const readCapped = async (response: Response, key: string, mime: string | undefined) => {
    if (!response.body) {
      try { postBody(key, mime, await response.arrayBuffer()); } catch { /* ignore */ }
      return;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) { void reader.cancel(); return; }
        chunks.push(value);
      }
    } catch {
      return;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    postBody(key, mime, merged.buffer);
  };

  // MSE plumbing: adaptive players (YouTube/Twitch/HTML5 video) feed a MediaSource
  // via createObjectURL and push segments through SourceBuffer.appendBuffer. We map
  // MediaSource -> blob URL, accumulate appended segments, and post them so the
  // <video src=blob:> asset becomes a real, classifiable, downloadable video.
  const mediaSourceUrls = new WeakMap<MediaSource, string>();
  const sourceBufferOwner = new WeakMap<SourceBuffer, MediaSource>();
  const mseParts = new Map<string, { parts: Uint8Array[]; total: number; timer?: number; lastPosted?: number }>();

  const accumulateMse = (url: string, chunk: Uint8Array) => {
    let entry = mseParts.get(url);
    if (!entry) { entry = { parts: [], total: 0 }; mseParts.set(url, entry); }
    if (entry.total >= MAX_BODY_BYTES) return;
    entry.parts.push(chunk);
    entry.total += chunk.byteLength;
    if (entry.timer) clearTimeout(entry.timer);
    const current = entry;
    entry.timer = window.setTimeout(() => {
      // Re-post only on meaningful growth (>=1MB) so a long stream doesn't re-merge
      // and re-encode the whole buffer on every appended segment.
      if (current.lastPosted !== undefined && current.total - current.lastPosted < 1024 * 1024) return;
      current.lastPosted = current.total;
      const cap = Math.min(current.total, MAX_BODY_BYTES);
      const merged = new Uint8Array(cap);
      let offset = 0;
      for (const part of current.parts) {
        if (offset >= cap) break;
        const slice = part.subarray(0, Math.min(part.byteLength, cap - offset));
        merged.set(slice, offset);
        offset += slice.byteLength;
      }
      postBody(url, undefined, merged.buffer);
    }, 1500);
  };

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (object: Blob | MediaSource) => {
    const blobUrl = originalCreateObjectURL(object);
    const blob = object instanceof Blob ? object : undefined;
    const isMediaSource = typeof MediaSource !== "undefined" && object instanceof MediaSource;
    if (isMediaSource) mediaSourceUrls.set(object, blobUrl);
    post({
      kind: "blob",
      blobUrl,
      mime: blob?.type,
      size: blob?.size,
      producerApi: isMediaSource ? "URL.createObjectURL(MediaSource)" : "URL.createObjectURL",
      hintKind: isMediaSource ? "video" : undefined,
      stack: new Error().stack,
      timestamp: Date.now()
    });
    if (blob) captureBlobBody(blobUrl, blob);
    return blobUrl;
  };

  if (typeof MediaSource !== "undefined") {
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function patchedAddSourceBuffer(type: string): SourceBuffer {
      const sourceBuffer = originalAddSourceBuffer.call(this, type);
      sourceBufferOwner.set(sourceBuffer, this);
      return sourceBuffer;
    };
    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function patchedAppendBuffer(data: BufferSource) {
      try {
        const owner = sourceBufferOwner.get(this);
        const url = owner ? mediaSourceUrls.get(owner) : undefined;
        if (url) {
          const view = data instanceof ArrayBuffer
            ? new Uint8Array(data.slice(0))
            : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          accumulateMse(url, view);
        }
      } catch {
        // Capturing must never break media playback.
      }
      return originalAppendBuffer.call(this, data as ArrayBuffer);
    };
  }

  URL.revokeObjectURL = (url: string) => {
    post({ kind: "blob-revoked", blobUrl: url, timestamp: Date.now() });
    const entry = mseParts.get(url);
    if (entry?.timer) clearTimeout(entry.timer);
    mseParts.delete(url); // release accumulated MSE segments for this stream
    return originalRevokeObjectURL(url);
  };

  // WebSocket binary frames (images/protobuf pushed by Figma/Slack/realtime apps)
  // are invisible to webRequest, which sees only the handshake. Capture each binary
  // frame as its own asset keyed by the socket URL.
  const OriginalWebSocket = window.WebSocket;
  if (OriginalWebSocket) {
    // Cap binary frames per socket so a chatty realtime socket can't flood
    // IndexedDB to its quota (which would silently drop all later captures).
    const MAX_WS_FRAMES = 24;
    // A real subclass preserves instanceof, static constants, and `extends`.
    class WrappedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        const wsUrl = typeof url === "string" ? url : url.toString();
        let frame = 0;
        this.addEventListener("message", (event: MessageEvent) => {
          if (frame >= MAX_WS_FRAMES) return;
          const data = event.data;
          if (data instanceof ArrayBuffer) postBody(`${wsUrl}#ws-${frame++}`, undefined, data);
          else if (typeof Blob !== "undefined" && data instanceof Blob) captureBlobBody(`${wsUrl}#ws-${frame++}`, data);
        });
      }
    }
    window.WebSocket = WrappedWebSocket as unknown as typeof WebSocket;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now();
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const mime = response.headers.get("content-type") ?? undefined;
    post({
      kind: "fetch",
      url,
      method: init?.method || (input instanceof Request ? input.method : "GET"),
      status: response.status,
      mime,
      size: Number(response.headers.get("content-length") ?? "") || undefined,
      timestamp: started
    });
    if (response.type !== "opaque" && response.type !== "opaqueredirect" && !(mime ?? "").includes("text/event-stream")) {
      const declared = Number(response.headers.get("content-length") ?? "");
      // Read when a finite, in-cap length is declared. When length is unknown
      // (chunked) we still read API/JSON/text — the user's primary target — but
      // skip video/audio, which are the large unbounded streams worth avoiding.
      const isStreamableMedia = (mime ?? "").startsWith("video/") || (mime ?? "").startsWith("audio/");
      const shouldRead = declared ? declared <= MAX_BODY_BYTES : !isStreamableMedia;
      if (shouldRead) void readCapped(response.clone(), url, mime);
    }
    return response;
  };

  // No Response.prototype.blob override: response bytes are already captured
  // non-destructively by the fetch/XHR hooks above, keyed by URL. A blob hook
  // here has no URL to correlate on and only produces empty-keyed junk records.

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL) {
    const xhr = this as XMLHttpRequest & { __assetInspector?: { method: string; url: string; startedAt: number } };
    xhr.__assetInspector = { method, url: url.toString(), startedAt: Date.now() };
    return Reflect.apply(originalOpen, this, arguments);
  };
  XMLHttpRequest.prototype.send = function patchedSend() {
    this.addEventListener("loadend", () => {
      const meta = (this as XMLHttpRequest & { __assetInspector?: { method: string; url: string; startedAt: number } }).__assetInspector;
      if (!meta) return;
      const mime = this.getResponseHeader("content-type") ?? undefined;
      post({
        kind: "xhr",
        url: meta.url,
        method: meta.method,
        status: this.status,
        mime,
        timestamp: meta.startedAt
      });
      try {
        const responseType = this.responseType;
        if (responseType === "" || responseType === "text") {
          if (this.responseText) postBody(meta.url, mime, textToBuffer(this.responseText));
        } else if (responseType === "arraybuffer") {
          if (this.response instanceof ArrayBuffer) postBody(meta.url, mime, this.response);
        } else if (responseType === "blob") {
          if (this.response instanceof Blob) captureBlobBody(meta.url, this.response);
        } else if (responseType === "json" && this.response !== null && this.response !== undefined) {
          postBody(meta.url, mime ?? "application/json", textToBuffer(JSON.stringify(this.response)));
        }
      } catch {
        // Reading a response in an unexpected state must never break the page.
      }
    });
    return Reflect.apply(originalSend, this, arguments);
  };

  // Inspector aid: force shadow roots open so the content script can descend
  // web components and capture imagery/fonts/sprites inside closed shadow DOM.
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function patchedAttachShadow(init: ShadowRootInit): ShadowRoot {
    return originalAttachShadow.call(this, { ...init, mode: "open" });
  };

  // SPA route changes don't reload the document and pushState/replaceState emit
  // no event; bridge them to a 'locationchange' the content script rescans on.
  const fireLocationChange = () => window.dispatchEvent(new Event("locationchange"));
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function patchedPushState(this: History, ...args: Parameters<History["pushState"]>): void {
    originalPushState.apply(this, args);
    fireLocationChange();
  };
  history.replaceState = function patchedReplaceState(this: History, ...args: Parameters<History["replaceState"]>): void {
    originalReplaceState.apply(this, args);
    fireLocationChange();
  };
  window.addEventListener("popstate", fireLocationChange);

  const originalReadAsDataURL = FileReader.prototype.readAsDataURL;
  FileReader.prototype.readAsDataURL = function patchedReadAsDataURL(blob: Blob) {
    this.addEventListener(
      "load",
      () => {
        if (typeof this.result === "string") {
          post({
            kind: "data-url",
            url: this.result.slice(0, 4096),
            mime: blob.type,
            size: blob.size,
            producerApi: "FileReader.readAsDataURL",
            timestamp: Date.now()
          });
        }
      },
      { once: true }
    );
    return originalReadAsDataURL.call(this, blob);
  };
})();

declare global {
  interface XMLHttpRequest {
    __assetInspector?: {
      method: string;
      url: string;
      startedAt: number;
    };
  }
}

export {};
