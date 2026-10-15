import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#0f766e"/><circle cx="200" cy="120" r="70" fill="#ccfbf1"/></svg>';
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/sample.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(svg);
  } else if (url.pathname === "/catalog.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ name: "Asset Lens demo", assets: ["sample.svg"], local: true }));
  } else if (url.pathname === "/favicon.ico") {
    res.writeHead(204).end();
  } else {
    const count = url.pathname === "/large" ? 1000 : 0;
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><title>Asset Lens local demo</title></head><body>
      <h1>Asset Lens local demo</h1><img src="/sample.svg" alt="Teal sample">
      <button onclick="fetch('/catalog.json')">Load catalog</button>
      ${Array.from({ length: count }, (_, i) => `<img data-src="/sample.svg?item=${i}" alt="Lazy image ${i}">`).join("")}
      </body></html>`);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), "asset-lens-smoke-"));
let context;
try {
  const extension = resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 480, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const fixture = await context.newPage();
  await fixture.goto(origin);
  const panel = await context.newPage();
  const errors = [];
  panel.on("pageerror", (error) => errors.push(error.message));
  await fixture.bringToFront();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.getByRole("option").filter({ hasText: "sample.svg" }).first().waitFor();
  await fixture.getByRole("button", { name: "Load catalog" }).click();
  await panel.getByRole("option").filter({ hasText: "catalog.json" }).first().waitFor();
  await panel.getByRole("option").filter({ hasText: "catalog.json" }).first().click();
  await panel.getByText('"local": true', { exact: false }).waitFor();
  await panel.getByText("Captured (offline-ready)", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Copy URL", exact: true }).focus();
  await panel.waitForTimeout(1800);
  assert.equal(await panel.getByRole("button", { name: "Copy URL", exact: true }).evaluate((el) => el === document.activeElement), true);
  await panel.getByRole("button", { name: "Close", exact: true }).click();

  const second = await context.newPage();
  await second.goto(`${origin}/large`);
  await second.bringToFront();
  await panel.waitForFunction(() => document.querySelector("header")?.textContent?.includes("100"));
  await second.getByRole("button", { name: "Load catalog" }).click();
  const layout = await panel.evaluate(() => {
    const list = document.querySelector('[role="listbox"]');
    return { rows: list.children.length, viewport: list.parentElement.clientHeight, total: list.clientHeight, pageHeight: document.documentElement.scrollHeight, height: innerHeight };
  });
  assert.ok(layout.rows < 40, `Expected windowed rendering, got ${layout.rows} rows`);
  assert.ok(layout.total >= 1000 * 56, "Expected at least 1,000 captured assets");
  assert.ok(layout.viewport < layout.total);
  assert.ok(layout.pageHeight <= layout.height, "The page must not grow with the asset list");
  await panel.getByRole("listbox").evaluate((el) => { el.parentElement.scrollTop = el.clientHeight; });
  await panel.getByRole("textbox", { name: "Filter assets by URL or MIME type" }).fill("catalog.json");
  await panel.getByRole("option").filter({ hasText: "catalog.json" }).waitFor();
  await panel.getByRole("textbox", { name: "Filter assets by URL or MIME type" }).fill("");
  await fixture.bringToFront();
  await panel.waitForFunction(() => document.querySelector('[role="listbox"]')?.children.length < 20);
  await panel.getByRole("option").filter({ hasText: "catalog.json" }).first().click();
  await panel.getByText('"local": true', { exact: false }).waitFor();
  if (process.env.UPDATE_SCREENSHOTS === "1") {
    await mkdir("docs/images", { recursive: true });
    await panel.setViewportSize({ width: 960, height: 720 });
    await panel.screenshot({ path: "docs/images/inspector.png" });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", checks: ["local capture", "captured JSON preview", "preview focus", "tab switching", "1000-asset virtualization", "filtering"], layout }, null, 2));
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
