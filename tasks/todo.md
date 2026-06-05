# Audit + UI/UX polish pass

Decisions: UI/UX + safe backend fixes · polished light/refined · slide-over drawer preview.

## Phase A — Backend hardening (no UI risk)
- [ ] service-worker: delete `requestStarts` entry on completed/error (fix unbounded Map)
- [ ] service-worker: prune session DB on `chrome.tabs.onRemoved`
- [ ] service-worker: make `upsertAsset` get→put atomic via Dexie transaction
- [ ] service-worker + exporters: ZIP prefers captured `assetBodies`; fallback fetch uses `credentials:"omit"`
- [ ] redact: broaden inline secrets (JWT, sk_/ghp_/AWS prefixes, more query keys)
- [ ] classify: remove dead ternary branch
- [ ] exporters: chunked `bytesToDataUrl` (drop per-byte loop)
- [ ] page-hooks: skip buffering large unbounded media streams (keep API/JSON capture)
- [ ] Verify: tsc + tests + build

## Phase B — Design tokens
- [ ] tailwind.config + global.css: refined tokens, per-kind badge colors, drawer animation, scrollbar
- [ ] Verify build

## Phase C — UI rewrite (App.tsx)
- [ ] Header: title + live counts + ghost icon actions (picker/refresh/clear/export menu)
- [ ] Filter: scrollable kind chips WITH counts (non-empty only) + refined search w/ clear
- [ ] Drop redundant 4-metric row; fold counts into header + chips
- [ ] Export: compact dropdown menu instead of 5 dark pills
- [ ] Deep capture: slim refined toggle
- [ ] Asset list: colored kind badge, filename/domain split, status pill, captured-body dot, hover row actions
- [ ] Preview: slide-over drawer overlay (backdrop, Esc/X close, translate transition)
- [ ] Context menu + empty/loading states refined
- [ ] Verify: tsc + build

## Review
All phases complete. Verified: `tsc --noEmit` clean, 22/22 tests pass, `npm run build` OK,
and the redesigned UI screenshotted in a temporary mocked-chrome harness (since removed)
confirming chips, badges, captured dots, status pills, slide-over drawer, context menu,
text preview, and empty state all render correctly.

Backend: requestStarts leak closed; closed-tab DB pruning added; upsertAsset + body-flag
now atomic; ZIP export prefers captured bytes and the fallback fetch dropped credentials;
redaction broadened (JWT + provider-key/AWS/GitHub/Slack/Google patterns); classify dead
branch removed; bytesToDataUrl chunked; page-hooks no longer buffers unbounded media streams.

Chunk-size build warning is pre-existing (model-viewer + React) and untouched.

## Phase D — Audit follow-ups (approved) — DONE
- [x] content-script: incremental MutationObserver (scan dirty elements, not full doc)
- [x] content-script: drop unused `extractAssetUrls` import
- [x] page-hooks: remove empty-blob `Response.prototype.blob` override
- [x] service-worker: guard blob events with empty blobUrl in recordPageHookEvent
- [x] service-worker: try/catch picker sendMessage (friendly chrome:// error)
- [x] types + service-worker: remove dead `exportStatus` field
- [x] Verify: tsc clean · 22/22 tests · build OK

No new tests added: these touch DOM/chrome-dependent code (content-script, service-worker)
that the suite intentionally doesn't import — matching the codebase convention of unit-testing
only the pure shared modules. Behavior is preserved; the empty-blob removal deletes a junk
source and adds a guard, so no visual harness re-run was needed.
