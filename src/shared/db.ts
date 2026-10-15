import Dexie, { type Table } from "dexie";
import type { AssetBodyRecord, AssetRecord, BlobRecord, ExportJob, MediaRecord, RequestEvent, SessionSnapshot } from "./types";
import { MAX_BODY_BYTES, MAX_SESSION_BODY_BYTES, MAX_TOTAL_BODY_BYTES, MAX_SESSION_BODIES, MAX_TOTAL_BODIES } from "./limits";

interface CaptureUsage {
  sessionId: string;
  bodyBytes: number;
  bodyCount: number;
  droppedBodies: number;
}

class AssetInspectorDatabase extends Dexie {
  assets!: Table<AssetRecord, string>;
  requests!: Table<RequestEvent, string>;
  blobs!: Table<BlobRecord, string>;
  media!: Table<MediaRecord, string>;
  exports!: Table<ExportJob, string>;
  assetBodies!: Table<AssetBodyRecord, string>;
  captureUsage!: Table<CaptureUsage, string>;

  constructor() {
    super("asset-lens");
    this.version(1).stores({
      assets: "id, sessionId, tabId, kind, url, updatedAt",
      requests: "id, sessionId, requestId, tabId, phase, timestamp",
      blobs: "id, sessionId, tabId, blobUrl, createdAt",
      media: "id, sessionId, tabId, manifestUrl, createdAt",
      exports: "id, sessionId, type, startedAt"
    });
    // Additive: store captured response/blob bytes so dynamic assets stay
    // previewable and downloadable after their source URL goes stale.
    this.version(2).stores({
      assetBodies: "assetId, sessionId, createdAt"
    });
    this.version(3).stores({ captureUsage: "sessionId" }).upgrade(async (transaction) => {
      const usage = new Map<string, CaptureUsage>();
      await transaction.table<AssetBodyRecord>("assetBodies").each((body) => {
        const session = usage.get(body.sessionId) ?? { sessionId: body.sessionId, bodyBytes: 0, bodyCount: 0, droppedBodies: 0 };
        session.bodyBytes += body.byteLength;
        session.bodyCount += 1;
        usage.set(body.sessionId, session);
      });
      await transaction.table("captureUsage").bulkPut([...usage.values()]);
    });
  }
}

export const db = new AssetInspectorDatabase();

export function sessionIdForTab(tabId?: number): string {
  return `tab-${tabId ?? "unknown"}`;
}

export async function getSnapshot(tabId?: number, includeRequests = false): Promise<SessionSnapshot> {
  const sessionId = sessionIdForTab(tabId);
  const [assets, blobs, media, requests, usage] = await Promise.all([
    db.assets.where("sessionId").equals(sessionId).reverse().sortBy("updatedAt"),
    db.blobs.where("sessionId").equals(sessionId).reverse().sortBy("createdAt"),
    db.media.where("sessionId").equals(sessionId).reverse().sortBy("createdAt"),
    includeRequests ? db.requests.where("sessionId").equals(sessionId).reverse().sortBy("timestamp") : Promise.resolve([]),
    db.captureUsage.get(sessionId)
  ]);
  return {
    sessionId,
    assets,
    blobs,
    media,
    requests,
    captureLimited: Boolean(usage?.droppedBodies) || (usage?.bodyBytes ?? 0) >= MAX_SESSION_BODY_BYTES,
    deepCaptureAttached: false
  };
}

export async function clearSession(tabId?: number): Promise<void> {
  const sessionId = sessionIdForTab(tabId);
  await db.transaction("rw", [db.assets, db.requests, db.blobs, db.media, db.exports, db.assetBodies, db.captureUsage], async () => {
    await Promise.all([
      db.assets.where("sessionId").equals(sessionId).delete(),
      db.requests.where("sessionId").equals(sessionId).delete(),
      db.blobs.where("sessionId").equals(sessionId).delete(),
      db.media.where("sessionId").equals(sessionId).delete(),
      db.exports.where("sessionId").equals(sessionId).delete(),
      db.assetBodies.where("sessionId").equals(sessionId).delete(),
      db.captureUsage.delete(sessionId)
    ]);
  });
}

export async function recordCaptureLimit(sessionId: string): Promise<void> {
  await db.transaction("rw", db.captureUsage, async () => {
    const usage = await db.captureUsage.get(sessionId) ?? { sessionId, bodyBytes: 0, bodyCount: 0, droppedBodies: 0 };
    await db.captureUsage.put({ ...usage, droppedBodies: Math.min(usage.droppedBodies + 1, 1_000_000) });
  });
}

export async function putAssetBody(body: AssetBodyRecord, signal?: AbortSignal): Promise<boolean> {
  return db.transaction("rw", [db.assetBodies, db.captureUsage], async () => {
    signal?.throwIfAborted();
    const previous = await db.assetBodies.get(body.assetId);
    const usage = await db.captureUsage.get(body.sessionId) ?? { sessionId: body.sessionId, bodyBytes: 0, bodyCount: 0, droppedBodies: 0 };
    const delta = body.bytes.byteLength - (previous?.byteLength ?? 0);
    const sessions = await db.captureUsage.toArray();
    const total = sessions.reduce((sum, item) => sum + item.bodyBytes, 0);
    const count = sessions.reduce((sum, item) => sum + item.bodyCount, 0);
    // Existing captures survive upgrades. Replacing one with fewer bytes is
    // allowed even when legacy data is already above the new budget.
    if ((previous && previous.sessionId !== body.sessionId) || body.bytes.byteLength > MAX_BODY_BYTES ||
      (!previous && (usage.bodyCount >= MAX_SESSION_BODIES || count >= MAX_TOTAL_BODIES)) ||
      (delta > 0 && (usage.bodyBytes + delta > MAX_SESSION_BODY_BYTES || total + delta > MAX_TOTAL_BODY_BYTES))) {
      await db.captureUsage.put({ ...usage, droppedBodies: Math.min(usage.droppedBodies + 1, 1_000_000) });
      return false;
    }
    signal?.throwIfAborted();
    await db.assetBodies.put({ ...body, byteLength: body.bytes.byteLength });
    await db.captureUsage.put({ ...usage, bodyBytes: usage.bodyBytes + delta, bodyCount: usage.bodyCount + (previous ? 0 : 1) });
    signal?.throwIfAborted();
    return true;
  });
}
