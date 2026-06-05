import { defineManifest } from "@crxjs/vite-plugin";

export const manifest = defineManifest({
  manifest_version: 3,
  name: "Universal Asset Inspector",
  short_name: "Asset Inspector",
  version: "0.1.0",
  description: "Inspect, classify, preview, and export browser-delivered assets in real time.",
  icons: {
    "16": "icons/asset-inspector-16.png",
    "32": "icons/asset-inspector-32.png",
    "48": "icons/asset-inspector-48.png",
    "128": "icons/asset-inspector-128.png"
  },
  permissions: [
    "activeTab",
    "downloads",
    "scripting",
    "sidePanel",
    "storage",
    "tabs",
    "webRequest"
  ],
  optional_permissions: ["debugger"],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module"
  },
  action: {
    default_icon: {
      "16": "icons/asset-inspector-16.png",
      "24": "icons/asset-inspector-24.png",
      "32": "icons/asset-inspector-32.png"
    },
    default_popup: "src/popup/index.html",
    default_title: "Asset Inspector"
  },
  side_panel: {
    default_path: "src/sidepanel/index.html"
  },
  devtools_page: "src/devtools/devtools.html",
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content-script.ts"],
      run_at: "document_start",
      all_frames: true
    },
    {
      // Page-world hooks must patch fetch/XHR/createObjectURL/history
      // BEFORE the page's own parse-time scripts run, so they execute in the MAIN
      // world at document_start rather than being injected asynchronously later.
      matches: ["<all_urls>"],
      js: ["src/content/page-hooks.ts"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN"
    }
  ]
});
