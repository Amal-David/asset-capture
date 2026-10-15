// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, db, getSnapshot } from "../src/shared/db";
import type { AssetRecord } from "../src/shared/types";

const asset = (tabId: number): AssetRecord => ({
  id: `asset-${tabId}`, sessionId: `tab-${tabId}`, tabId, url: "https://example.com/image.png",
  kind: "image", sources: ["dom"], previewAvailable: true, redactionFlags: [], createdAt: 1, updatedAt: 1
});

beforeEach(async () => { await db.open(); });

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

it("keeps request history available for exports without loading it into UI snapshots", async () => {
  await db.assets.put(asset(1));
  await db.requests.put({ id: "request", requestId: "1", sessionId: "tab-1", url: asset(1).url, phase: "completed", timestamp: 1 });
  const ui = await getSnapshot(1);
  expect(ui.assets).toEqual([asset(1)]);
  expect(ui.requests).toEqual([]);
  expect((await getSnapshot(1, true)).requests).toHaveLength(1);
});

it("clears a session atomically and preserves other tabs", async () => {
  await db.assets.bulkPut([asset(1), asset(2)]);
  await db.assetBodies.put({ assetId: "asset-1", sessionId: "tab-1", mime: "image/png", bytes: new Uint8Array([1]), byteLength: 1, createdAt: 1 });
  const failure = vi.spyOn(db.assetBodies, "where").mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
  await expect(clearSession(1)).rejects.toThrow("Storage unavailable");
  failure.mockRestore();
  expect(await db.assets.get("asset-1")).toBeDefined();
  expect(await db.assetBodies.get("asset-1")).toBeDefined();
  await clearSession(1);
  expect(await db.assets.get("asset-1")).toBeUndefined();
  expect(await db.assetBodies.get("asset-1")).toBeUndefined();
  expect(await db.assets.get("asset-2")).toBeDefined();
});
