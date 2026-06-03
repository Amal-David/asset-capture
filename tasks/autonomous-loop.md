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
- G done (6c6400c): debugger getResponseBody + MSE appendBuffer capture. All 16 backlog items done.
- Adversarial verify round 1 (wg42z3q61): 20 confirmed findings.
- Fixes done (4fd7846): all 20 fixed (MAIN-world hooks, capped stream reader, shadow-root prune,
  full-byte sniff, mime-clobber guard, DASH AdaptationSet, namespaced DRM, selection prune,
  bulk count, sort tiebreaker, windowing deps, image probe timeout, non-ok text error, image-set,
  url() regex, size threshold, json/mp3/m4a sniff). 39 tests. Visually verified streams + HEIC card.
- Adversarial round 2 (wdhwbkdit): 14 findings.
- Round-2 fixes (9fdaba3): 12 implemented (export/FETCH_TEXT body redaction [CRITICAL], postMessage origin,
  scheme allowlist, debugger meta level + tab-scoped keys + detach purge, takeRecords on reobserve,
  selection-prune empty guard, FETCH_TEXT streaming, MSE buffer release, HAR map, PDF document kind +
  embed preview, WebSocket binary-frame capture, resolved clickable variant URIs). 40 tests.
  DEFERRED (need new dep -> 7-day cooldown / user approval): hls.js playable stream preview;
  true list virtualizer for 5k+ assets (current windowing covers typical sessions).
- Adversarial round 3 (wqg0qiygc): 11 findings.
- Round-3 fixes (999cd6b): all 11 — persistence-boundary body redaction [CRITICAL: closes preview/
  clipboard/CDP leaks], WebSocket 24-frame cap + class subclass [CRITICAL quota DoS], fatal-decode in
  export redaction, streams visible in popup, silent background poll (preserves action errors),
  broadened secret patterns (ya29/openai/github-pat/PEM), startup orphan-session sweep, MSE re-post
  throttle, drawer role=dialog focus trap/restore, id-based keyboard focus. 41 tests.
- Round 4 (wyn70oa0p): 1 finding (unbounded requests table) -> fixed (ab8e4f7): per-session cap +
  try/catch + header redaction at rest. Visually verified compact/popup streams + PDF document kind.
- Round 5 (weassbpfr): CONVERGED-CLEAN — zero must-fix findings. Loop converged (20->14->11->1->0).
- Iteration 6 (7753c49): archive entry listing (zip-bomb-safe via fflate filter), image dimensions.
  Targeted adversarial review of the new code: CLEAN (verified vs fflate internals).
- PR #1 description refreshed to full scope.
- STATE: converged-clean, 41 tests, build green, ~22 commits. Branch work/audit-ui-hardening.
- Iteration 7 (user approved both deferred items): hls.js@1.6.16 HLS playable preview (pinned,
  --ignore-scripts, cooldown-clear, IOC-scanned, code-split) [69e560e]; dep-free fixed-row
  virtualizer (avoided @tanstack worm namespace) [69e560e]. Adversarial review found HLS re-render
  churn + native leak + dead prop -> fixed [3a811bb]. Virtualizer verified with 300-asset harness.
- All articulated goals met. No outstanding deferred items.
- Intentionally out of scope: SSE/EventSource capture (data stream, not downloadable assets).
