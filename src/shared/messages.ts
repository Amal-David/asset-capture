import type { AssetRecord, BlobRecord, ExportResult, MediaRecord, RequestEvent, SessionSnapshot } from "./types";

export type PageHookEvent =
  | { kind: "fetch" | "xhr"; url: string; method?: string; status?: number; mime?: string; size?: number; timestamp: number }
  | { kind: "blob"; blobUrl: string; mime?: string; size?: number; producerApi: string; stack?: string; timestamp: number }
  | { kind: "blob-revoked"; blobUrl: string; timestamp: number }
  | { kind: "data-url"; url: string; mime?: string; size?: number; producerApi: string; timestamp: number };

export type RuntimeMessage =
  | {
      type: "DOM_ASSET_BATCH";
      assets: Array<Partial<AssetRecord> & Pick<AssetRecord, "url" | "sources">>;
      media?: Array<Partial<MediaRecord> & Pick<MediaRecord, "manifestUrl" | "mediaKind">>;
      pageUrl: string;
    }
  | {
      type: "PAGE_HOOK_EVENT";
      event: PageHookEvent;
      pageUrl: string;
    }
  | { type: "GET_SNAPSHOT"; tabId?: number }
  | { type: "CLEAR_SESSION"; tabId?: number }
  | { type: "EXPORT"; exportType: "json" | "csv" | "url-list" | "har" | "zip"; tabId?: number; selectedIds?: string[] }
  | { type: "TOGGLE_DEEP_CAPTURE"; tabId: number; enabled: boolean }
  | { type: "ASSET_BODY"; key: string; mime?: string; base64: string; pageUrl: string }
  | { type: "GET_ASSET_BODY"; assetId: string; tabId?: number }
  | { type: "DOWNLOAD_ASSET"; url: string; filename?: string; assetId?: string }
  | { type: "PICKER_ACTIVATE"; tabId: number }
  | { type: "PICKER_DEACTIVATE"; tabId: number }
  | { type: "PICKER_RESULT"; assetUrl: string; cssSelector?: string; pageUrl: string }
  | { type: "PICKER_CANCELLED"; pageUrl: string };

export type RuntimeResponse =
  | { ok: true; snapshot: SessionSnapshot; pickerResult?: PickerResult }
  | { ok: true; export: ExportResult }
  | { ok: true; deepCaptureAttached: boolean }
  | { ok: true; downloadId?: number }
  | { ok: true; body: { mime: string; dataUrl: string } | null }
  | { ok: false; error: string };

export interface PickerResult {
  assetUrl: string;
  cssSelector?: string;
  pageUrl: string;
  timestamp: number;
}

export function sendMessage<T extends RuntimeResponse>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message ?? "Runtime message failed" } as T);
        return;
      }
      resolve(response ?? ({ ok: false, error: "No response" } as T));
    });
  });
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
