# Task Graph

## Graph Metadata
- Change ID: `comprehensive-runtime-capture`
- Title: Comprehensive Runtime Capture

## Graph Layout
- `T-0101` fix-page-hook-capture-gaps
- `T-0102` fix-content-script-capture-gaps
- `T-0103` fix-background-capture-gaps
- `T-0104` widen-frame-coverage-and-verify
  - depends_on_all: T-0101, T-0102, T-0103

## Notes
- Audit findings driving this change (2026-06-10):
  1. fetch/XHR page hooks post raw (possibly relative) URLs; assets/bodies get mis-keyed and never merge with webRequest records.
  2. CSS-in-JS via CSSOM (`insertRule`/`replace`/`replaceSync`/`adoptedStyleSheets`) produces no DOM mutations; url() assets from styled-components/emotion production mode are missed.
  3. CSS rule scanning uses a fixed property allowlist; custom properties (`--bg: url(...)`) and other url()-bearing props are missed.
  4. Assets loaded before inspection starts are dropped by the capture gate; no history replay on panel open (performance resource timeline + buffered hook events).
  5. about:blank / srcdoc / blob: frames get no content scripts (no `match_about_blank` / `match_origin_as_fallback`); embedded players/widgets are invisible to DOM and hook capture.
  6. HLS/DASH manifests are only detected by URL extension during DOM scan; hls.js-style XHR-fetched manifests never produce MediaRecords.
  7. Deep capture enables CDP Network without buffer sizing; large/slow bodies are evicted before `getResponseBody`.
  8. `FontFace` API loads and canvas-generated assets (`toBlob`/`toDataURL`) are not hooked.
  9. classify() lacks `main_frame`/`sub_frame` → document mapping.
  10. Social/meta image references (og:image, twitter:image) are not scanned.
- Known limitations intentionally out of scope: worker/service-worker-context fetch hooking, MSE-in-workers, WebRTC/WebTransport, OOPIF auto-attach for deep capture (debugger metadata still covers network).
- MV3 posture constraints hold: capture stays gated to active inspection (replay supplies pre-inspection history at inspection start instead of always-on capture).
