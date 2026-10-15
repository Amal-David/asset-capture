# Asset Lens — Privacy Policy

Last updated: October 15, 2026

Asset Lens is a Chrome extension for inspecting and saving web-page assets. It has no account system, analytics, telemetry, or project-operated backend. Captures are not uploaded to a project server.

## What the extension processes

Capture scripts run on pages allowed by Chrome's site-access settings. They inspect asset references, page-level network activity, and some runtime objects. Hooks and bounded metadata buffers can run before you open the inspector.

The background service worker records ordinary capture messages only for tabs with a recently active inspector or capture action. Stored information can include URLs, request and response metadata, DOM references, and size-capped asset bodies. Optional deep capture attaches Chrome's debugger to the inspected tab. It ends on navigation or reload, detach, tab closure, or removal of debugger permission.

## Local storage and deletion

Captured records and bytes are stored in IndexedDB inside the extension's browser profile. Original URLs are kept locally so previews and downloads can use them; they may contain signed parameters or other sensitive values.

New captured bodies are limited to 64 MiB / 4,096 bodies per tab and 256 MiB / 16,384 bodies across tabs, with a 16 MiB per-body limit. Existing captures are preserved during upgrades; new bytes can be refused when a budget is reached. Local usage counters record stored byte totals, body counts, and limit notices.

Deep-capture tab IDs are saved in Chrome's session storage so the service worker can reconcile attachment ownership after restarting. This session state is cleared by Chrome when the browser session ends. Restart recovery does not attach to previously unattached tabs.

**Clear session** deletes stored capture for that tab. Closing a tab triggers the same cleanup. At browser startup, the extension attempts to prune data for tabs that no longer exist. Cleanup can be interrupted by a crash or storage failure; closing a tab is not a secure-erasure guarantee. Uninstalling the extension removes its local storage through Chrome.

## Network requests and exports

Asset Lens does not send captures to an analytics or collection service. It can still make network requests:

- Opening previews may load assets from their original hosts, including companion files for models.
- The Streams panel requests manifest text when it opens. Playing HLS requests playlists and segments.
- ZIP export fetches files whose bodies were not captured, with cookies omitted.
- Text preview fetches also omit cookies.
- Individual downloads use captured bytes when available. Otherwise Chrome downloads the original URL and may send cookies for that host according to its download behavior.
- **Open in new tab** navigates to the asset host normally. **Copy URL** puts the original URL on the clipboard.

These requests reveal the usual connection information, including the request URL and IP address, to the contacted hosts. URL parameters can carry credentials even when cookies are omitted. Browser requests and redirects are subject to the host's policies.

Exports are handed to Chrome's download system and saved where you choose. Files leave the device if you subsequently share them or save them to a synchronized location.

## Redaction

Recognized sensitive headers are redacted before storage. Recognized secret patterns in text-like captured bodies are also redacted. Metadata exports redact sensitive URL parameters and URL credentials, including referring-page URLs.

Redaction is best-effort and does not guarantee removal of personal data or every secret. Original URLs remain in local records and ordinary clipboard actions. Binary bodies are not sanitized. Text redaction can change a downloaded text file. Review exports before sharing them.

## Permissions

The manifest requests broad host access (`<all_urls>`) plus `activeTab`, `tabs`, `webRequest`, `scripting`, `storage`, `downloads`, and `sidePanel`. Chrome's site-access controls can restrict where the extension runs. The optional `debugger` permission is requested when you enable deep capture.

All application code is bundled with the extension. There is no advertising or sale of captured information.

## Contact and changes

Questions or concerns can be reported through [GitHub issues](https://github.com/Amal-David/asset-capture/issues). Policy changes will be published in this file with an updated date.
