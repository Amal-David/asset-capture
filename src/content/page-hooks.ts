(() => {
  // Bytes are captured non-destructively (clones / immutable blobs) so dynamic
  // and API-rendered assets stay previewable and downloadable after their URL
  // goes stale. Reads stay off the synchronous return path and are size-capped.
  const MAX_BODY_BYTES = 16 * 1024 * 1024;

  const post = (payload: unknown) => {
    window.postMessage({ source: "asset-inspector-page-hook", payload }, "*");
  };

  const postBody = (key: string, mime: string | undefined, buffer: ArrayBuffer | undefined) => {
    if (!key || !buffer || buffer.byteLength === 0 || buffer.byteLength > MAX_BODY_BYTES) return;
    window.postMessage({ source: "asset-inspector-page-hook-body", payload: { key, mime, buffer } }, "*");
  };

  const captureBlobBody = (key: string, blob: Blob) => {
    if (blob.size > MAX_BODY_BYTES) return;
    void blob.arrayBuffer().then((buffer) => postBody(key, blob.type || undefined, buffer)).catch(() => undefined);
  };

  const textToBuffer = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (object: Blob | MediaSource) => {
    const blobUrl = originalCreateObjectURL(object);
    const blob = object instanceof Blob ? object : undefined;
    post({
      kind: "blob",
      blobUrl,
      mime: blob?.type,
      size: blob?.size,
      producerApi: "URL.createObjectURL",
      stack: new Error().stack,
      timestamp: Date.now()
    });
    if (blob) captureBlobBody(blobUrl, blob);
    return blobUrl;
  };

  URL.revokeObjectURL = (url: string) => {
    post({ kind: "blob-revoked", blobUrl: url, timestamp: Date.now() });
    return originalRevokeObjectURL(url);
  };

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
      if (shouldRead) {
        void response.clone().arrayBuffer().then((buffer) => postBody(url, mime, buffer)).catch(() => undefined);
      }
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
