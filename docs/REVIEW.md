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

Implementation locations: [App.tsx](../src/sidepanel/App.tsx), [store.ts](../src/sidepanel/store.ts), [exporters.ts](../src/shared/exporters.ts), [har.ts](../src/shared/har.ts), [db.ts](../src/shared/db.ts), and [service-worker.ts](../src/background/service-worker.ts).

## Performance changes

- Routine snapshots no longer load, sort, serialize, and transfer the request-event history every 1.5 seconds. HAR and ZIP exports still request it. Database tests verify both paths.
- Overlapping background refreshes are skipped while a snapshot is pending. Explicit refreshes can supersede earlier requests.
- Selected ZIP exports retrieve only selected assets' stored bodies instead of every body in the tab session.
- Export membership uses a Set instead of repeatedly scanning the selected-ID array.
- Bulk toolbar actions reuse one filtered selection instead of computing it separately for the count and each action.

Measured Chromium fixture: more than 1,000 asset records, 18 rendered rows, a 517 px scroll viewport, and an 800 px document. This is a rendering-bound check, not a general CPU or latency benchmark.

The main app bundle increased from approximately 246 kB to 276 kB minified after the dependency refresh and fixes. The lazy HLS chunk remains about 523 kB and model-viewer about 1,013 kB. Their existing chunk-size warnings remain; this change does not claim smaller downloads.

## Dependency review

The initial `npm audit` reported 18 advisories. Compatible lockfile updates reduced that to 7: 5 high and 2 moderate, all in the development dependency graph. `npm audit --omit=dev` reports zero advisories as of this review.

Remaining packages: `tailwindcss`, `braces`, `chokidar`, `fast-glob`, `micromatch`, `postcss-nested`, and `postcss-selector-parser`. npm recommends Tailwind 4 for the full remediation path. A Tailwind major-version migration requires separate CSS/build verification; it was not forced here. These counts are package advisory reports, not proof that the production extension is exploitable or vulnerability-free.

The installed npm 10.9.8 resolver failed internally during updates. npm 11 refreshed the lockfile successfully; ordinary `npm ci` then installed it successfully. See the upstream [npm resolver issue](https://github.com/npm/cli/issues/9787) for similar failures. No legacy peer-dependency or forced-major workaround was applied.

## Verification

- Baseline: 50 tests passed and the production build passed.
- Added store, React UI, HAR, and IndexedDB regression coverage; the resulting suite has 65 tests.
- TypeScript checking is included in `npm run build`.
- `npm run test:browser` loads the actual built extension in an isolated Chromium profile. It exercises local capture after a page action, persisted JSON bytes, preview focus, tab switching, filtering after scrolling, and virtualization.
- The README screenshot comes from that local fixture, not a production site or a mock of Chrome messaging.
- Added a GitHub Actions workflow for tests and the browser smoke check. Local success is not hosted CI proof; inspect the PR checks for the hosted result.
- No lint command exists in this repository. No separate lint result is claimed.

The simplification review ran sequentially using the reuse, quality, efficiency, and maintainability rubrics. Existing `redactUrl`, `getSnapshot`, `CapturedBody`, and Dexie transaction APIs were reused. One efficiency finding was applied: ZIP body-ID preparation now runs only for ZIP exports. No new general-purpose framework or forwarding wrapper was introduced. The other passes found no further behavior-preserving changes worth applying; a broad component split was left out of this defect-focused change.

## Remaining work

1. **Capture startup ordering (P2).** A very fast local response during page reload produced metadata but no stored bytes in Chromium. The built content script uses an asynchronous import loader, while the page hook runs directly at document start; a bridge-startup race is the likely cause, not yet isolated conclusively. A deliberate page action after inspection was ready did persist bytes. The smoke test asserts that supported path. Investigate a bounded startup handoff or build arrangement without silently expanding always-on recording.
2. **Aggregate memory budgets (P2).** A 16 MiB per-body cap does not bound a session or ZIP. ZIP compression is synchronous, and remote ZIP preview reads the complete response before listing entries. Add total budgets, cancellation, and bounded preview reads before claiming large-session resilience.
3. **Debugger lifecycle (P2).** Deep-capture attachment is tracked in service-worker memory. Reconcile real attachments after worker suspension/restart, and test navigation, detach, and permission revocation. Those flows were not exercised here.
4. **Permissions and distribution.** Broad host access and pre-inspection hooks remain the current design. A per-site opt-in model would change onboarding and capture behavior and needs a separate product decision. Chrome Web Store installation, review status, and publication were not verified.
5. **Maintenance.** The main UI file remains large. Separate preview components when their behavior next changes, with the current tests protecting state and focus. The repository has no root project license; choose one explicitly before describing it as licensed open-source software.

Manual verification still needed: the native Chrome side-panel launcher, DevTools docking, deep capture, real media codecs, model companion files, PDF embedding, file-save dialogs, and long-running sessions on representative sites. No merge, store publication, or deployment is implied by these checks.

Chrome's [download API documentation](https://developer.chrome.com/docs/extensions/reference/api/downloads) and [tabs API documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs) were checked when describing network behavior and tab tracking.
