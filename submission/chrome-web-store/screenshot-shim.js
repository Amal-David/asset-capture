// Screenshot harness: mocks the chrome.* surface the side panel uses and feeds
// it realistic sample data, so the REAL built UI can be rendered and captured
// outside an extension context. Demo data only — never shipped in the package.
(() => {
  const now = Date.now();
  const CDN = "https://cdn.lumastore.app";
  const SITE = "https://lumastore.app";
  const API = "https://api.lumastore.app";

  // Injected by the harness builder: data URL of the demo preview image.
  const DEMO_IMAGE = window.__DEMO_IMAGE_DATA_URL__ || "";
  const DEMO_IMAGE_BYTES = window.__DEMO_IMAGE_BYTES__ || 0;

  let idSeq = 0;
  const asset = (url, kind, overrides = {}) => {
    idSeq += 1;
    const ageMs = (overrides.ageS ?? idSeq * 7) * 1000;
    delete overrides.ageS;
    return Object.assign({
      id: "asset-demo-" + idSeq,
      sessionId: "tab-1",
      tabId: 1,
      url,
      kind,
      mime: undefined,
      extension: (url.split("?")[0].match(/\.([a-z0-9]+)$/i) || [])[1],
      method: "GET",
      status: 200,
      size: undefined,
      timing: { startedAt: now - ageMs - 180, completedAt: now - ageMs, durationMs: 120 + (idSeq * 37) % 600 },
      resourceType: undefined,
      initiator: SITE + "/collections/spring",
      frameOrigin: SITE,
      sources: ["webRequest"],
      domReferences: [],
      previewAvailable: true,
      bodyAvailable: false,
      redactionFlags: [],
      createdAt: now - ageMs - 1000,
      updatedAt: now - ageMs
    }, overrides);
  };

  const assets = [
    asset(CDN + "/img/hero-banner.avif", "image", { mime: "image/avif", size: 412388, sources: ["webRequest", "dom", "performance"], domReferences: ["#hero img"], bodyAvailable: true, resourceType: "image", ageS: 2 }),
    asset(CDN + "/img/product-gallery-01.webp", "image", { mime: "image/webp", size: 184223, sources: ["webRequest", "dom"], domReferences: ['img[data-testid="gallery-1"]'], bodyAvailable: true, resourceType: "image", ageS: 9 }),
    asset(CDN + "/img/product-gallery-02.webp", "image", { mime: "image/webp", size: 176980, sources: ["webRequest", "dom"], bodyAvailable: true, resourceType: "image", ageS: 11 }),
    asset(CDN + "/img/lookbook-team.jpg", "image", { mime: "image/jpeg", size: 642115, sources: ["webRequest", "performance", "css"], resourceType: "image", ageS: 14 }),
    asset(CDN + "/brand/logo.svg", "image", { mime: "image/svg+xml", size: 8412, sources: ["webRequest", "dom"], bodyAvailable: true, resourceType: "image", ageS: 17 }),
    asset(CDN + "/img/og-card.png", "image", { mime: "image/png", size: 98342, sources: ["dom"], domReferences: ['meta[property="og:image"]'], ageS: 21 }),
    asset(CDN + "/video/promo-reel.mp4", "video", { mime: "video/mp4", size: 8421900, sources: ["webRequest", "media", "dom"], domReferences: ["video.hero-loop"], resourceType: "media", ageS: 6 }),
    asset("blob:" + SITE + "/9f3c2a1e-6d2b-4f6e-8f1a-2b9d4c7e5a10", "video", { mime: "video/mp4", size: 6291456, sources: ["blob", "media"], bodyAvailable: true, ageS: 3 }),
    asset(CDN + "/audio/ambient-track.mp3", "audio", { mime: "audio/mpeg", size: 3146100, sources: ["webRequest", "media"], resourceType: "media", ageS: 26 }),
    asset(CDN + "/streams/spring-show/master.m3u8", "manifest", { mime: "application/vnd.apple.mpegurl", size: 1843, sources: ["xhr", "webRequest"], resourceType: "xmlhttprequest", ageS: 5 }),
    asset(CDN + "/fonts/Inter-roman.var.woff2", "font", { mime: "font/woff2", size: 348812, sources: ["webRequest", "css"], bodyAvailable: true, resourceType: "font", ageS: 30 }),
    asset(CDN + "/fonts/PlayfairDisplay-Bold.woff2", "font", { mime: "font/woff2", size: 121400, sources: ["webRequest", "css"], resourceType: "font", ageS: 32 }),
    asset(CDN + "/css/app.min.css", "css", { mime: "text/css", size: 88210, sources: ["webRequest", "dom"], resourceType: "stylesheet", ageS: 35 }),
    asset(CDN + "/css/theme-tokens.css", "css", { mime: "text/css", size: 12044, sources: ["webRequest", "css"], resourceType: "stylesheet", ageS: 36 }),
    asset(CDN + "/js/vendor.bundle.js", "script", { mime: "text/javascript", size: 421774, sources: ["webRequest", "dom"], resourceType: "script", ageS: 38 }),
    asset(CDN + "/js/app.bundle.js", "script", { mime: "text/javascript", size: 188032, sources: ["webRequest", "dom"], resourceType: "script", ageS: 39 }),
    asset(API + "/v1/products?page=1&limit=24", "api", { mime: "application/json", size: 47210, sources: ["fetch", "webRequest"], bodyAvailable: true, resourceType: "xmlhttprequest", ageS: 8 }),
    asset(API + "/v1/recommendations?user=demo", "api", { mime: "application/json", size: 9831, sources: ["fetch"], bodyAvailable: true, redactionFlags: ["authorization-header"], ageS: 12 }),
    asset(CDN + "/wasm/image-decoder.wasm", "wasm", { mime: "application/wasm", size: 1262144, sources: ["fetch", "webRequest"], ageS: 41 }),
    asset(CDN + "/3d/showroom.glb", "model", { mime: "model/gltf-binary", size: 2516582, sources: ["fetch", "webRequest"], ageS: 44 }),
    asset(CDN + "/captions/spring-show-en.vtt", "subtitle", { mime: "text/vtt", size: 5120, sources: ["webRequest", "dom"], domReferences: ["track"], ageS: 46 }),
    asset("canvas:lx9k2-3", "image", { mime: "image/png", size: DEMO_IMAGE_BYTES || 91230, sources: ["hook"], bodyAvailable: true, ageS: 19 })
  ];

  const requests = [];
  for (let i = 0; i < assets.length; i += 1) {
    requests.push({
      id: "req-" + i + ":completed",
      requestId: String(1000 + i),
      sessionId: "tab-1",
      tabId: 1,
      phase: "completed",
      url: assets[i].url,
      method: "GET",
      status: 200,
      mime: assets[i].mime,
      resourceType: assets[i].resourceType,
      timestamp: assets[i].updatedAt
    });
  }

  const snapshot = {
    sessionId: "tab-1",
    assets,
    blobs: [
      { id: "blob-1", sessionId: "tab-1", tabId: 1, blobUrl: "blob:" + SITE + "/9f3c2a1e-6d2b-4f6e-8f1a-2b9d4c7e5a10", mime: "video/mp4", size: 6291456, producerApi: "URL.createObjectURL(MediaSource)", createdAt: now - 3000, previewStatus: "available" },
      { id: "blob-2", sessionId: "tab-1", tabId: 1, blobUrl: "blob:" + SITE + "/77d0aa92-1f33-4f3e-b1c4-9e8d2c6b5a41", mime: "image/png", size: 91230, producerApi: "HTMLCanvasElement.toBlob", createdAt: now - 2000, previewStatus: "available" }
    ],
    media: [
      { id: "media-1", sessionId: "tab-1", tabId: 1, manifestUrl: CDN + "/streams/spring-show/master.m3u8", mediaKind: "hls", createdAt: now - 5000 }
    ],
    requests,
    deepCaptureAttached: true,
    pickerActive: false
  };

  const HLS_MASTER = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
    "1080p/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"',
    "720p/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2"',
    "480p/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.42e01e,mp4a.40.2"',
    "360p/index.m3u8"
  ].join("\n");

  const respond = (message) => {
    if (message.type === "GET_SNAPSHOT") return { ok: true, snapshot };
    if (message.type === "GET_ASSET_BODY") {
      return { ok: true, body: DEMO_IMAGE ? { mime: "image/png", dataUrl: DEMO_IMAGE, byteLength: DEMO_IMAGE_BYTES } : null };
    }
    if (message.type === "FETCH_TEXT") {
      return { ok: true, text: { content: HLS_MASTER, truncated: false, ok: true, status: 200, contentType: "application/vnd.apple.mpegurl" } };
    }
    if (message.type === "TOGGLE_DEEP_CAPTURE") return { ok: true, deepCaptureAttached: true };
    if (message.type === "DOWNLOAD_ASSET") return { ok: true, downloadId: 1 };
    return { ok: true };
  };

  window.chrome = {
    runtime: {
      id: "demo",
      lastError: undefined,
      sendMessage: (message, callback) => { setTimeout(() => callback(respond(message)), 30); },
      onMessage: { addListener: () => undefined }
    },
    tabs: {
      query: (_q, callback) => callback([{ id: 1, url: SITE + "/collections/spring", title: "Lumastore — Spring Collection" }]),
      create: () => undefined
    },
    permissions: { request: () => Promise.resolve(true) }
  };

  // Scripted interactions for specific screenshots, selected via location.hash.
  const clickWhen = (predicate, attempts = 40) => {
    const timer = setInterval(() => {
      const candidates = Array.from(document.querySelectorAll('[role="option"], li, button, [role="row"]'));
      const target = candidates.find(predicate);
      if (target) { clearInterval(timer); target.click(); }
      else if ((attempts -= 1) <= 0) clearInterval(timer);
    }, 250);
  };
  if (location.hash === "#preview") {
    clickWhen((el) => (el.textContent || "").includes("hero-banner.avif"));
  }
  if (location.hash === "#images") {
    clickWhen((el) => el.tagName === "BUTTON" && (el.textContent || "").trim().toLowerCase().startsWith("image"));
  }
})();
