/// <reference types="vitest/config" />
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { manifest } from "./src/manifest";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        sidepanel: "src/sidepanel/index.html",
        devtools: "src/devtools/devtools.html",
        devtoolsPanel: "src/devtools/panel.html"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
