# Chrome Web Store Submission Notes

## Package

- Upload ZIP: `/Users/amal/Documents/asset-capture/submission/chrome-web-store/asset-lens-0.2.0.zip`
- Unpacked extension path for local testing: `/Users/amal/Documents/asset-capture/dist`
- Rebuild package command: `npm run package:chrome`

## Listing Copy

### Name

Asset Lens

### Short Description

Inspect, preview, and export the assets a webpage loads in real time.

### Detailed Description

Asset Lens is a Chrome extension for developers, designers, QA teams, and technical operators who need to understand what a page actually loads.

Open the side panel or DevTools panel on a page to inspect discovered images, videos, audio, fonts, scripts, CSS, API responses, manifests, archives, 3D models, and other browser-delivered assets. The extension merges network events, DOM scans, page hooks, stylesheet references, blobs, data URLs, and stream manifests into one searchable asset table.

Core capabilities:

- Live asset table with filtering, sorting, preview status, byte availability, and domain facets.
- Render-or-hide previews for supported images, video, audio, fonts, text, and glTF models.
- HLS and DASH stream metadata, including variants, resolution, codecs, segment counts, and DRM indicators.
- Runtime capture: blob: and data: assets, MediaSource segments, WebSocket binary frames, canvas exports, FontFace loads, and CSS-in-JS injected styles.
- History replay: open the panel after the page loaded and still see the full asset history (resource timing + buffered runtime events).
- Works inside about:blank, srcdoc, and blob: frames where embedded players and widgets render.
- Export as JSON, CSV, URL list, HAR, or ZIP.
- Redaction for sensitive headers, tokens, credentials, signed query parameters, and high-confidence secret shapes.
- Optional Deep capture for debugger-backed response bodies and closed-shadow capture on the inspected tab.

The extension scopes capture to tabs with an active inspector surface or recent user action. Deep capture asks for the Chrome debugger permission only when the user turns it on.

## Dashboard Fields

- Category: Developer Tools
- Language: English
- Homepage URL: https://github.com/Amal-David/asset-capture
- Support URL: https://github.com/Amal-David/asset-capture/issues
- Privacy policy URL: https://github.com/Amal-David/asset-capture/blob/main/PRIVACY.md
- Single purpose: Asset Lens has a single purpose: let the user inspect, preview, and export the assets (images, media, fonts, scripts, styles, API responses, streams) loaded by the web page they are viewing.
- Remote code: No, the extension does not use remote code.
- Data usage: the extension does not collect or transmit any user data; all processing is local (see PRIVACY.md).

## Permission Justifications

- `activeTab`: Identify and inspect the current tab after user action.
- `downloads`: Save exported JSON, CSV, URL lists, HAR files, ZIP archives, and individual assets.
- `scripting`: Run targeted capture helpers for rescan, picker, and Deep capture behaviors.
- `sidePanel`: Provide the main inspector surface.
- `storage`: Store session metadata, captured asset records, export history, and capped response bytes locally.
- `tabs`: Resolve the active tab and route capture state to the correct tab session.
- `webRequest`: Observe request and response metadata for assets loaded by the inspected tab.
- `optional_permissions.debugger`: Requested only when Deep capture is enabled to read response bodies unavailable through standard MV3 APIs.
- `host_permissions.<all_urls>`: Required to inspect assets across arbitrary pages selected by the user.

## Privacy Summary

Data is processed locally in the browser extension. Captured records and capped response bytes are stored in extension-local IndexedDB for the active session and are pruned when tabs close. Exports are user-initiated downloads. The extension does not include a backend service in this repository.

## Web Store Assets

- Extension icon: `/Users/amal/Documents/asset-capture/public/icons/asset-lens-128.png`
- Logo SVG source: `/Users/amal/Documents/asset-capture/public/icons/asset-lens.svg`
- Small promo PNG: `/Users/amal/Documents/asset-capture/submission/chrome-web-store/promo-small.png`
- Small promo SVG source: `/Users/amal/Documents/asset-capture/submission/chrome-web-store/promo-small.svg`

## Remaining Dashboard Steps

- Capture at least one real screenshot at `1280x800` or `640x400` from the running extension UI.
- Upload the ZIP package.
- Upload the 440x280 small promotional image.
- Complete the privacy fields using the local-processing summary above.
- Add reviewer test instructions: load the extension, open a normal webpage, open the side panel, click Refresh or Rescan, optionally enable Deep capture and accept the debugger permission prompt, then export JSON or ZIP.
