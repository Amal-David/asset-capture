# Autonomous loop — world-class asset capture

Goal: most comprehensive + intelligent asset-capture extension. Adversarial agents find gaps → implement → verify (tsc/tests/build) → re-attack → commit/push to `work/audit-ui-hardening`. Build stays green every commit. Push only to that branch; never merge/destroy.

## Backlog (from adversarial recon `wrgoixeuy`, 16 items / 8 clusters)

### A. byte-sniffing-classifier
- [ ] 1 (crit/M) Magic-byte sniffer in classify.ts + re-classify on byte arrival in storeAssetBody (recompute kind/mime/previewAvailable; sniffed mime beats generic)
- [ ] 2 (high/S) Plumb real webRequest resourceType into classifier (stop passing sources[0]='webRequest' as resourceType)

### B. filters-sort-ui
- [ ] 3 (crit/M) Sort controls (updatedAt/createdAt/size/status/name/kind + dir) + freeze live reshuffle; status-class filter
- [ ] 4 (high/M) Facet filters: has-bytes / previewable toggles, multi-select kinds, domain & source facets
- [ ] 5 (high/M) Virtualize list + popup "showing 50 of N" + keyboard nav (roving tabindex, listbox/option)
- [ ] 6 (high/M) Multi-select + bulk actions; wire ExportJob.selectedIds

### C. css-shadow-capture
- [ ] 7 (crit/M) CSSOM sweep: styleSheets+adoptedStyleSheets background/mask/border-image/@font-face/image-set
- [ ] 8 (crit/L) Shadow DOM capture (scan+observer+picker); SVG use/image hrefs; force open attachShadow

### D. dom-lazy-spa
- [ ] 9 (high/S) Lazyload data-src/data-srcset/data-bg + link rel/as hints
- [ ] 10 (high/S) SPA rescan (pushState/popstate/hashchange) + periodic safety rescan + Rescan button

### E. preview-robustness
- [ ] 11 (high/M) Shared render-probe (render-or-hide) image/video/audio/font/model + undecodable/dead-blob cards
- [ ] 12 (med/S) Object URLs (not giant base64) for media previews + size threshold
- [ ] 13 (high/M) FETCH_TEXT via service worker (kill CORS) for text/manifest/subtitle; ok/opaque/truncation

### F. media-ui
- [ ] 14 (crit/M) Render Streams/Media panel from snapshot.media (HLS/DASH) + DRM flag + manifest variant parse

### G. media-bytes-deep
- [ ] 15 (high/L) Debugger Network.getResponseBody for SW/cache/cross-origin/static bytes
- [ ] 16 (high/L) MSE hooks: SourceBuffer.appendBuffer capture + MediaSource blob→video; segment assemble

## Progress log
- Iteration 1: backlog created (16 items / 8 clusters) from adversarial recon.
- A done (f771733): magic-byte sniffer + resourceType classification.
- B1 done (6388626): multi-select kinds, status/bytes/previewable/domain facets, client sort.
- B2 done (cdffbb6): multi-select rows + bulk actions, keyboard nav, windowing, popup cap. Visually verified.
- C done (2f044c9): CSSOM sweep, shadow DOM, SVG sprites, lazyload, SPA auto-rescan.
- rank10 tail (6332fbd): manual Rescan button.
- E done (641d47f): render-probe (render-or-hide), object URLs, SW FETCH_TEXT for text.
- F done (77ab385): Streams panel + HLS/DASH manifest parser (+tests).
- Remaining: Cluster G (rank 15 debugger getResponseBody, rank 16 MSE/appendBuffer).
- Running adversarial verification workflow on A-F; then implement G + fix verified findings.
