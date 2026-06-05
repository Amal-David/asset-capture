import { defineManifest } from "@crxjs/vite-plugin";

export const manifest = defineManifest({
  manifest_version: 3,
  name: "Universal Asset Inspector",
  short_name: "Asset Inspector",
  version: "0.1.0",
  description: "Inspect, classify, preview, and export browser-delivered assets in real time.",
  permissions: [
    "activeTab",
    "debugger",
    "downloads",
    "scripting",
    "sidePanel",
    "storage",
    "tabs",
    "webRequest"
  ],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module"
  },
  action: {
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
      // Page-world hooks must patch fetch/XHR/createObjectURL/attachShadow/history
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
