// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, db, getSnapshot, putAssetBody } from "../src/shared/db";

vi.mock("../src/shared/limits", () => ({ MAX_BODY_BYTES: 16, MAX_SESSION_BODY_BYTES: 32, MAX_TOTAL_BODY_BYTES: 48, MAX_SESSION_BODIES: 4, MAX_TOTAL_BODIES: 6 }));
const body = (assetId: string, sessionId = "tab-1", size = 16) => ({ assetId, sessionId, mime: "image/png", bytes: new Uint8Array(size), byteLength: size, createdAt: 1 });
beforeEach(async () => { await db.open(); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

it("enforces session and global budgets atomically under concurrent writes", async () => {
  const results = await Promise.all(["a", "b", "c"].map((id) => putAssetBody(body(id))));
  expect(results.filter(Boolean)).toHaveLength(2);
  expect((await getSnapshot(1)).captureLimited).toBe(true);
  expect(await putAssetBody(body("d", "tab-2"))).toBe(true);
  expect(await putAssetBody(body("e", "tab-3"))).toBe(false);
  expect((await db.captureUsage.toArray()).reduce((n, row) => n + row.bodyBytes, 0)).toBe(48);
  expect(await db.assetBodies.get("e")).toBeUndefined();
});

it("accounts for replacement bytes and releases capacity on clear", async () => {
  await putAssetBody(body("a"));
  await putAssetBody(body("b"));
  expect(await putAssetBody(body("a", "tab-1", 8))).toBe(true);
  expect(await putAssetBody(body("c", "tab-1", 8))).toBe(true);
  expect(await putAssetBody(body("c", "tab-1", 17))).toBe(false);
  expect((await db.assetBodies.get("c"))?.byteLength).toBe(8);
  await clearSession(1);
  expect(await db.captureUsage.get("tab-1")).toBeUndefined();
  expect(await putAssetBody(body("d", "tab-2"))).toBe(true);
});

it("bounds tiny-body counts and rejects cross-session key collisions", async () => {
  for (let i = 0; i < 4; i++) expect(await putAssetBody(body(`a${i}`, "tab-1", 1))).toBe(true);
  expect(await putAssetBody(body("overflow", "tab-1", 1))).toBe(false);
  expect(await putAssetBody(body("a0", "tab-2", 1))).toBe(false);
  expect((await db.assetBodies.get("a0"))?.sessionId).toBe("tab-1");
  await putAssetBody(body("b", "tab-2", 1));
  await putAssetBody(body("c", "tab-2", 1));
  expect(await putAssetBody(body("d", "tab-3", 1))).toBe(false);
});

it("rolls back bytes and accounting when capture is detached during a write", async () => {
  await putAssetBody(body("a"));
  const controller = new AbortController();
  const put = db.assetBodies.put.bind(db.assetBodies);
  vi.spyOn(db.assetBodies, "put").mockImplementationOnce(async (...args) => {
    const key = await put(...args);
    controller.abort(new Error("Detached"));
    return key;
  });
  await expect(putAssetBody(body("a", "tab-1", 8), controller.signal)).rejects.toThrow("Detached");
  expect((await db.assetBodies.get("a"))?.byteLength).toBe(16);
  expect((await db.captureUsage.get("tab-1"))?.bodyBytes).toBe(16);
});

it("migrates existing captures without deleting bytes and blocks further growth", async () => {
  await db.delete();
  const old = new Dexie("asset-lens");
  old.version(1).stores({ assets: "id, sessionId, tabId, kind, url, updatedAt", requests: "id, sessionId, requestId, tabId, phase, timestamp", blobs: "id, sessionId, tabId, blobUrl, createdAt", media: "id, sessionId, tabId, manifestUrl, createdAt", exports: "id, sessionId, type, startedAt" });
  old.version(2).stores({ assetBodies: "assetId, sessionId, createdAt" });
  await old.open();
  await old.table("assetBodies").bulkPut([body("a"), body("b"), body("c")]);
  old.close();
  await db.open();
  expect(await db.assetBodies.count()).toBe(3);
  expect((await db.captureUsage.get("tab-1"))?.bodyBytes).toBe(48);
  expect(await putAssetBody(body("d"))).toBe(false);
  expect(await putAssetBody(body("a", "tab-1", 8))).toBe(true);
});
