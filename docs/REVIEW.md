# Engineering and product review

Reviewed October 15, 2026, starting from `b3505ad2289dae5dc98c8ccfb1e003403823d2f6`.

Scope: README and privacy claims, inspector state, preview lifecycle, filtering and export scope, HAR output, database access, dependency health, and local Chromium behavior. This is a focused review, not a claim that every capture path or external website has been verified.

## Findings addressed

| Severity | Finding | Change and evidence |
| --- | --- | --- |
| P1 | Bulk ZIP exported hidden selected rows while its toolbar advertised only visible selections. | All bulk actions now use the same visible selection. UI regression test checks the actual export message. |
| P1 | Exported referring-page URLs retained sensitive query parameters. | Reused `redactUrl` for the initiator field. JSON regression test checks both asset and referring-page URLs. |
| P2 | Late snapshots and completed actions could restore the previous tab's session. | Refresh generations reject stale responses; pending background polls are skipped; clear/rescan/deep-capture completions check tab identity. Store regression tests cover reordered responses and actions. |
| P2 | Side panel remained attached to the initially active tab. | Added window-scoped tab activation handling. UI and real-extension Chromium checks cover switching; explicit DevTools tab IDs remain fixed. |
| P2 | Empty snapshots kept stale checkbox selection. | Selection is pruned even when the result is empty. Store regression test covers clearing the last asset. |
| P2 | The asset list could grow the page instead of scrolling inside its viewport. | Bounded the inspector height and stream section; kept list virtualization and clamped offsets after filtering. Chromium rendered 18 rows for more than 1,000 assets in an 800 px page. |
| P2 | Background refresh repeatedly stole focus from preview buttons. | Stabilized the drawer close callback and keyed previews by asset ID. UI and Chromium checks retain focus across polling. Removed assets no longer leave a stale drawer visible. |
| P2 | Successfully loaded audio/video previews became failures after 12 seconds. | Probes settle once and cancel their timeout. A regression test advances the timer past 12 seconds after successful decoding. |
| P2 | HTTP error pages and truncated manifest text could be presented as stream details. | Reject these responses and display an error. UI regression test covers an HTTP 403 body. |
| P2 | HAR headers were read from the wrong phases; exports invented HTTP/2 and reported version 0.1.0. | Correlate the latest request's phases, leave unknown protocols blank, and use the package version. Test covers ascending and descending request order. |
| P2 | An explicitly empty export selection meant “all assets.” | Undefined means all; an empty list means none. A regression test prevents accidental scope expansion. |
| P2 | Session deletion could partially succeed across database tables. | Use one Dexie transaction. A simulated storage failure verifies rollback and isolation from other tabs. This does not prevent new capture events from arriving after a clear. |
| P2 | Request timing entries were retained when a request ended after inspection expired. | Completion/error handlers now delete timing entries even when capture is inactive. Verified by tracing handler control flow; no direct lifecycle integration test. |
| P2 | README and privacy policy overstated capture completeness, inactivity, redaction, and absence of network requests. | Rewrote both against the manifest and request/storage paths. The README now follows meshy2glb's installation/usage/formats/limitations structure. |
| P2 | Immediate startup responses could arrive before the asynchronous content-script bridge. | Use CRXJS's standalone synchronous bundle. Chromium now verifies stored bytes from an inline startup fetch. |
| P2 | Per-file limits did not bound accumulated bodies, queued work, ZIP output, or archive-preview reads. | Add transactional byte/count budgets, bounded page reads/transfers/MSE buffers, cancellable ZIP assembly, and capped/time-limited response reads. Unit and Chromium checks cover the boundaries. |
| P2 | Debugger state disappeared on worker restart and cleanup could race reattachment. | Persist tab IDs in session storage, verify ownership before restoring, serialize lifecycle changes, and invalidate late events/bodies. Chromium verifies recovery after an actual forced worker stop. |
| P2 | Seven development dependency advisories remained in the Tailwind 3 chain. | Migrate to Tailwind 4.3.3 and its PostCSS plugin, preserve affected utilities, and remove autoprefixer. The full audit now reports zero advisories. |

Implementation locations: [App.tsx](../src/sidepanel/App.tsx), [store.ts](../src/sidepanel/store.ts), [exporters.ts](../src/shared/exporters.ts), [har.ts](../src/shared/har.ts), [db.ts](../src/shared/db.ts), and [service-worker.ts](../src/background/service-worker.ts).

## Performance changes

- Routine snapshots no longer load, sort, serialize, and transfer the request-event history every 1.5 seconds. HAR and ZIP exports still request it. Database tests verify both paths.
- Overlapping background refreshes are skipped while a snapshot is pending. Explicit refreshes can supersede earlier requests.
- Selected ZIP exports retrieve only selected assets' stored bodies instead of every body in the tab session.
- Export membership uses a Set instead of repeatedly scanning the selected-ID array.
- Bulk toolbar actions reuse one filtered selection instead of computing it separately for the count and each action.

Measured Chromium fixture after follow-up: more than 1,000 asset records, 18 rendered rows, a 518 px scroll viewport, and an 800 px document. This is a rendering-bound check, not a general CPU or latency benchmark.

The main app bundle increased from approximately 246 kB to 277 kB minified after the dependency refresh and fixes. The lazy HLS chunk remains about 523 kB and model-viewer about 1,013 kB. Their existing chunk-size warnings remain; this change does not claim smaller downloads.

## Dependency review

The initial `npm audit` reported 18 advisories. Compatible updates reduced that to seven. The authorized follow-up migrated Tailwind 3 to Tailwind 4.3.3 with `@tailwindcss/postcss`, removed autoprefixer, and updated affected shadow and outline utilities. The full `npm audit` now reports zero advisories, including development dependencies.

The vulnerable Tailwind 3 dependency chain is no longer in the lockfile. The production build, computed theme-color assertion, browser flows, and inspected screenshot verify the migration locally. Audit results describe known package advisories at the time checked, not a guarantee that the extension has no vulnerabilities.

The installed npm 10.9.8 resolver failed internally during updates. npm 11 refreshed the lockfile successfully; ordinary `npm ci` then installed it successfully. See the upstream [npm resolver issue](https://github.com/npm/cli/issues/9787) for similar failures. No legacy peer-dependency or forced-major workaround was applied.

## Verification

- Baseline: 50 tests passed and the production build passed.
- Added store, React UI, HAR, IndexedDB, budget, read-cancellation, and debugger lifecycle regression coverage; the resulting suite has 85 tests.
- TypeScript checking is included in `npm run build`.
- `npm run test:browser` loads the actual built extension in isolated Chromium profiles. It exercises immediate startup response bytes, ordinary JSON capture, preview focus, tab switching, filtering after scrolling, virtualization, capture backpressure, and cancellation of a stalled HTTP download during ZIP preparation.
- The debugger browser check grants the existing optional permission in a temporary test manifest. It verifies attach, a forced service-worker stop and restart, navigation-triggered detach, and explicit detach. The attachment survived the forced stop in Chromium and was correctly recovered. The native permission prompt is not exercised; permission-removal events and attach/restore races are covered by unit tests.
- The README screenshot comes from that local fixture, not a production site or a mock of Chrome messaging.
- Added a GitHub Actions workflow for tests and the browser smoke check. Local success is not hosted CI proof; inspect the PR checks for the hosted result.
- No lint command exists in this repository. No separate lint result is claimed.

The simplification review ran sequentially using the reuse, quality, efficiency, and maintainability rubrics. Existing redaction, snapshot, and Dexie APIs were reused. Bounded network reads share one implementation; the superseded text reader was removed. Debugger lifecycle handling was separated from capture persistence. ZIP body preparation runs only for ZIP exports, and the archive writer yields between files. No generic workflow framework or forwarding wrapper was added.

## Enforced budgets

| Resource | Limit and outcome |
| --- | --- |
| Stored body | 16 MiB maximum. |
| Stored bodies per tab | 64 MiB and 4,096 records; growth is rejected when either limit is reached. |
| Stored bodies across tabs | 256 MiB and 16,384 records; enforced in the same transaction as each body write. |
| Migration | Preserve existing bytes and initialize usage counters. Legacy over-budget data blocks new growth but can be replaced with smaller bodies or explicitly cleared. |
| Page work | Two concurrent asynchronous body reads; at most 32 MiB / 64 unacknowledged body messages per frame. |
| MSE copies | 16 MiB total per frame, up to 16 streams and 1,024 chunks per stream. Original playback buffers are left untouched. |
| Background body writes | Two at once, including debugger body reads. |
| ZIP | One export at a time, at most 256 selected assets and 64 MiB of archive output. Stored ZIP entries avoid a synchronous compression pass. |
| Network reads | 16 MiB for ZIP fallback/preview, 200,000 bytes for text, 1,024 chunks, and a 15-second timeout. Cancellation closes the reader/request. |
| Export duration | Two minutes, with a visible Cancel export control. |

Capture-limit notices persist with the session. ZIP failure reports identify omitted files; archive writer failures abort instead of producing a corrupt ZIP. These are payload/work budgets, not a claim that the browser process's total RAM is capped at the same values.

## Remaining work

1. **Permissions and distribution.** Broad host access and pre-inspection hooks remain the current design. A per-site opt-in model would change onboarding and capture behavior and needs a separate product decision. Chrome Web Store installation, review status, and publication were not verified.
2. **Maintenance.** The main UI file remains large. Separate preview components when their behavior next changes, with the current tests protecting state and focus. The repository has no root project license; choose one explicitly before describing it as licensed open-source software.

Manual verification still needed: the native Chrome side-panel launcher, DevTools docking and permission prompts, real media codecs, model companion files, PDF embedding, file-save dialogs, and long-running sessions on representative sites. No merge, store publication, or deployment is implied by these checks.

Chrome's [download API documentation](https://developer.chrome.com/docs/extensions/reference/api/downloads) and [tabs API documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs) were checked when describing network behavior and tab tracking.
