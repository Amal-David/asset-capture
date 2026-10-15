import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><title>Debugger fixture</title><img src="data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\"/>">');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const temporary = await mkdtemp(resolve(tmpdir(), "asset-lens-debugger-"));
let context;
try {
  const extension = resolve(temporary, "extension");
  await cp("dist", extension, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));
  assert.ok(manifest.optional_permissions.includes("debugger"));
  assert.ok(!manifest.permissions.includes("debugger"));
  // Grant the existing optional permission in this isolated test profile. The
  // production manifest stays unchanged; native permission prompts are not tested.
  manifest.permissions.push("debugger");
  manifest.optional_permissions = manifest.optional_permissions.filter((value) => value !== "debugger");
  await writeFile(resolve(extension, "manifest.json"), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(resolve(temporary, "profile"), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--silent-debugger-extension-api"]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const fixture = await context.newPage();
  await fixture.goto(origin);
  const panel = await context.newPage();
  await fixture.bringToFront();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  const tabId = await panel.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, `${origin}/`);
  assert.ok(tabId !== undefined);
  const message = (type, enabled) => panel.evaluate(({ type, enabled, tabId }) => chrome.runtime.sendMessage({ type, enabled, tabId }), { type, enabled, tabId });
  assert.equal((await message("TOGGLE_DEEP_CAPTURE", true)).ok, true);
  assert.equal((await message("GET_SNAPSHOT")).snapshot.deepCaptureAttached, true);

  const cdp = await context.newCDPSession(panel);
  let versionId;
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    const version = versions.find((item) => item.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && item.runningStatus === "running");
    if (version) versionId = version.versionId;
  });
  await cdp.send("ServiceWorker.enable");
  for (let attempt = 0; !versionId && attempt < 50; attempt++) await delay(100);
  assert.ok(versionId, "Extension worker must be visible to the debugger test");
  await cdp.send("ServiceWorker.stopWorker", { versionId });
  const recovered = await message("GET_SNAPSHOT");
  assert.equal(recovered.ok, true);
  const actualAttached = await panel.evaluate(async (id) => {
    try { await chrome.debugger.sendCommand({ tabId: id }, "Runtime.getIsolateId"); return true; } catch { return false; }
  }, tabId);
  assert.equal(recovered.snapshot.deepCaptureAttached, actualAttached);
  const saved = await panel.evaluate(async () => (await chrome.storage.session.get("deepCaptureTabIds")).deepCaptureTabIds);
  assert.equal(saved.includes(tabId), actualAttached);

  assert.equal((await message("TOGGLE_DEEP_CAPTURE", true)).ok, true);
  await fixture.goto(`${origin}/next`);
  await panel.waitForFunction(async (id) => !(await chrome.runtime.sendMessage({ type: "GET_SNAPSHOT", tabId: id })).snapshot.deepCaptureAttached, tabId);
  await panel.waitForFunction(async (id) => {
    try { await chrome.debugger.sendCommand({ tabId: id }, "Runtime.getIsolateId"); return false; } catch { return true; }
  }, tabId);

  assert.equal((await message("TOGGLE_DEEP_CAPTURE", true)).ok, true);
  assert.equal((await message("TOGGLE_DEEP_CAPTURE", false)).ok, true);
  assert.equal((await message("GET_SNAPSHOT")).snapshot.deepCaptureAttached, false);
  assert.deepEqual(await panel.evaluate(async () => (await chrome.storage.session.get("deepCaptureTabIds")).deepCaptureTabIds), []);
  console.log(JSON.stringify({ result: "passed", checks: ["attach", "forced worker restart reconciliation", "navigation detach", "explicit detach"], attachmentSurvivedForcedStop: actualAttached, permissionPromptTested: false }, null, 2));
} finally {
  await context?.close();
  await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
