# Universal Asset Inspector

Chrome MV3 extension for inspecting, classifying, previewing, and exporting assets loaded by a webpage.

## Run

```sh
npm install
npm run build
```

Load `/Users/amal/Documents/asset-capture/dist` as an unpacked extension from `chrome://extensions`.

## What Works

- Passive capture from `chrome.webRequest`, DOM scans, resource timing, media elements, fetch/XHR hooks, blob URLs, and data URLs.
- MV3 surfaces: popup, side panel, background service worker, content script, page-world hook, and DevTools panel.
- IndexedDB session persistence through Dexie.
- Deterministic asset classification and preview eligibility.
- Export actions for JSON, CSV, URL list, HAR, and ZIP.
- ZIP export attempts authorized in-session fetches and writes failures to `failures.json`.
- Redaction for credentials, sensitive headers, bearer tokens, and signed/token query parameters.
- Opt-in deep capture through `chrome.debugger`; it is never attached silently.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm audit --json
```
