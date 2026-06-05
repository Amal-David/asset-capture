# Universal Asset Inspector

Chrome MV3 extension for capturing, classifying, previewing, and exporting every
asset a webpage delivers — including assets that are dynamically rendered by APIs
(fetch/XHR), produced as `blob:`/`data:` URLs, streamed via MSE, or hidden inside
shadow DOM and stylesheets.

## Run

```sh
npm install
npm run build
```

Load `/Users/amal/Documents/asset-capture/dist` as an unpacked extension from
`chrome://extensions`, then open the side panel (or the DevTools "Asset Inspector"
panel) on any tab.

## Capture coverage

Assets are captured from many independent sources and merged into one record per URL:

- **Network**: `chrome.webRequest` (all phases, with resource-type signal), plus
  page-world `fetch`/XMLHttpRequest hooks that also capture the response **bytes**.
- **Page bytes**: `URL.createObjectURL` blobs, `FileReader` data URLs, and
  `MediaSource` + `SourceBuffer.appendBuffer` segments (adaptive/MSE video).
- **DOM**: `img/source/video/audio/track/script/link/iframe/embed/object` plus
  `<image>`/`<use>` SVG sprite refs, `srcset`/`imagesrcset`, and lazyload
  `data-src`/`data-srcset`/`data-bg`/… attributes (captured before scroll).
- **Shadow DOM**: open *and* force-opened closed roots are descended in scans, the
  mutation observer, and the element picker.
- **CSS**: `document.styleSheets` + constructable/adopted stylesheets are swept for
  `background-image`/`mask`/`border-image`/`list-style`/`cursor`/`content` url()s,
  `image-set()`, `@font-face src`, and `@import`.
- **SPA**: `pushState`/`replaceState`/`popstate`/`hashchange` trigger rescans, plus
  backed-off safety passes and a manual **Rescan** button.
- **Deep capture** (opt-in `chrome.debugger`): `Network.getResponseBody` reads bytes
  the page never fetched — browser-initiated static assets, opaque cross-origin
  responses, and service-worker/Cache-API replays.

The page-world hooks run as a `MAIN`-world content script at `document_start`, so
they are installed before the page's own scripts.

## Intelligent classification

- **Magic-byte sniffing**: when the wire MIME is missing or generic
  (`application/octet-stream`, `text/plain`, …), the captured bytes are sniffed
  (PNG/JPEG/GIF/WEBP/AVIF/HEIC/BMP/ICO, mp4/webm/quicktime, woff/woff2/ttf/otf,
  glTF, mp3/ogg/flac/wav, pdf/wasm/zip/gz/7z/rar/bzip2, plus a guarded SVG/JSON text
  probe). The asset is then re-classified and becomes previewable — so extensionless
  CDN/object-store URLs and mislabeled APIs are rescued.
- Byte-derived MIME beats a generic wire type, and a later generic webRequest event
  never clobbers a sniffed specific type.

## Preview (render-or-hide)

- Images/video/audio/fonts/glTF models are **probed off-DOM** and rendered only once
  they actually decode; anything that fails (incl. a stall timeout for slow CDNs)
  shows a "download to inspect" card instead of a broken element.
- Non-browser-decodable image formats (HEIC/JXL/EXR/HDR/TIFF) and bytes-less `blob:`
  URLs show explicit, honest cards.
- Captured bytes preview via lightweight object URLs (not multi-MB data: URLs).
- Text (JSON/API/CSS/manifest/subtitle) is fetched through the service worker (host
  permissions) to bypass CORS; non-OK responses surface as errors with status, not
  as the asset's content.
- **Streams** panel parses HLS/DASH manifests for variants, resolutions, codecs,
  segment counts, and a DRM/encryption flag.

## Filters, sort & bulk actions

- Multi-select kind chips, status-class filter (2xx/3xx/4xx/5xx/none), has-bytes /
  previewable toggles, domain facet, and full-text query over URL/MIME/source.
- Client-side sort (last/first seen, size, status, name, type) with a stable
  tiebreaker so rows don't reshuffle under the live refresh.
- Per-row checkboxes + bulk Download / Copy URLs / Export ZIP; keyboard navigation
  (roving listbox); windowed rendering for large sessions.

## Export & privacy

- Export as JSON, CSV, URL list, HAR, or ZIP. ZIP embeds already-captured bytes and
  only falls back to a credential-less fetch otherwise; failures are written to
  `failures.json`.
- Redaction covers credentials, sensitive headers, bearer tokens, signed/token query
  params, and high-confidence secret shapes (JWT, Stripe/AWS/GitHub/Slack/Google keys).
- A closed tab's captured data (including bytes) is pruned automatically.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm audit --json
```
