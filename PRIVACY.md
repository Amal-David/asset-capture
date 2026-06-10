# Asset Lens — Privacy Policy

_Last updated: June 10, 2026_

Asset Lens is a Chrome extension that lets you inspect, preview, and export the
assets (images, video, audio, fonts, scripts, styles, API responses, streams)
loaded by the web page you are viewing.

## Summary

**Asset Lens does not collect, transmit, sell, or share any user data.**
Everything the extension captures is processed and stored locally in your
browser and never leaves your device unless you explicitly export it yourself.

## What the extension processes

When you open the Asset Lens panel on a tab (or trigger a capture action), the
extension observes, for that tab only:

- Network request and response **metadata** (URLs, headers, MIME types, sizes,
  timings) for assets the page loads.
- Asset references found in the page's DOM and stylesheets.
- Asset bytes (size-capped) for previews and exports, including blob: and
  data: assets created at runtime by the page.

Capture is scoped to tabs with an active inspector surface or recent user
action. The optional "Deep capture" mode additionally uses Chrome's debugger
API on the inspected tab, and only after you accept Chrome's permission prompt.

## Where data is stored

All captured records and bytes are stored in the extension's **local
IndexedDB** inside your browser profile. Records are kept per tab session and
are deleted when the tab closes (orphaned data is pruned on browser startup).
You can also clear a session at any time from the panel.

## What leaves your device

Nothing, automatically. The only ways data leaves the extension are actions
you take yourself:

- **Exports** (JSON, CSV, URL list, HAR, ZIP) are saved through Chrome's
  download dialog to a location you choose.
- **Downloads** of individual assets work the same way.

Before storage and export, Asset Lens redacts sensitive values it recognizes
(authorization/cookie headers, tokens, signed query parameters, and
high-confidence secret shapes).

## What the extension does NOT do

- No analytics, telemetry, or crash reporting.
- No remote servers; the extension has no backend.
- No remote code execution; all code ships inside the extension package.
- No selling or sharing of any data with third parties.
- No use of data for advertising, creditworthiness, or any unrelated purpose.

## Permissions

The extension requests only the permissions needed for local inspection:
`activeTab`, `tabs`, `webRequest`, `scripting`, `storage`, `downloads`,
`sidePanel`, host access for the pages you choose to inspect, and an
**optional** `debugger` permission requested only when you enable Deep capture.

## Changes

If this policy changes, the updated text will be published at this same URL
with a new "Last updated" date.

## Contact

Questions or concerns: open an issue at
<https://github.com/Amal-David/asset-capture/issues>.
