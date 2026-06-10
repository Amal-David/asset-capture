import Dexie, { type Table } from "dexie";
import type { AssetBodyRecord, AssetRecord, BlobRecord, ExportJob, MediaRecord, RequestEvent, SessionSnapshot } from "./types";

class AssetInspectorDatabase extends Dexie {
  assets!: Table<AssetRecord, string>;
  requests!: Table<RequestEvent, string>;
  blobs!: Table<BlobRecord, string>;
  media!: Table<MediaRecord, string>;
  exports!: Table<ExportJob, string>;
  assetBodies!: Table<AssetBodyRecord, string>;

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
  }
}

export const db = new AssetInspectorDatabase();

export function sessionIdForTab(tabId?: number): string {
  return `tab-${tabId ?? "unknown"}`;
}

export async function getSnapshot(tabId?: number): Promise<SessionSnapshot> {
  const sessionId = sessionIdForTab(tabId);
  const [assets, blobs, media, requests] = await Promise.all([
    db.assets.where("sessionId").equals(sessionId).reverse().sortBy("updatedAt"),
    db.blobs.where("sessionId").equals(sessionId).reverse().sortBy("createdAt"),
    db.media.where("sessionId").equals(sessionId).reverse().sortBy("createdAt"),
    db.requests.where("sessionId").equals(sessionId).reverse().sortBy("timestamp")
  ]);
  return {
    sessionId,
    assets,
    blobs,
    media,
    requests,
    deepCaptureAttached: false
  };
}

export async function clearSession(tabId?: number): Promise<void> {
  const sessionId = sessionIdForTab(tabId);
  await Promise.all([
    db.assets.where("sessionId").equals(sessionId).delete(),
    db.requests.where("sessionId").equals(sessionId).delete(),
    db.blobs.where("sessionId").equals(sessionId).delete(),
    db.media.where("sessionId").equals(sessionId).delete(),
    db.exports.where("sessionId").equals(sessionId).delete(),
    db.assetBodies.where("sessionId").equals(sessionId).delete()
  ]);
}
