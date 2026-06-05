export type AssetKind =
  | "image"
  | "video"
  | "audio"
  | "font"
  | "json"
  | "api"
  | "css"
  | "script"
  | "wasm"
  | "archive"
  | "model"
  | "subtitle"
  | "manifest"
  | "document"
  | "binary"
  | "unknown";

export type CaptureSource =
  | "webRequest"
  | "dom"
  | "css"
  | "performance"
  | "fetch"
  | "xhr"
  | "blob"
  | "data"
  | "media"
  | "devtools";

export interface TimingSummary {
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface AssetRecord {
  id: string;
  sessionId: string;
  tabId?: number;
  frameId?: number;
  url: string;
  originalUrl?: string;
  kind: AssetKind;
  mime?: string;
  extension?: string;
  method?: string;
  status?: number;
  size?: number;
  timing?: TimingSummary;
  resourceType?: string;
  initiator?: string;
  frameOrigin?: string;
  sources: CaptureSource[];
  domReferences?: string[];
  previewAvailable: boolean;
  bodyAvailable?: boolean;
  redactionFlags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RequestEvent {
  id: string;
  requestId: string;
  sessionId: string;
  tabId?: number;
  frameId?: number;
  phase:
    | "beforeRequest"
    | "sendHeaders"
    | "headersReceived"
    | "responseStarted"
    | "completed"
    | "error"
    | "devtools";
  url: string;
  method?: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  mime?: string;
  resourceType?: string;
  cacheState?: string;
  errorText?: string;
  initiator?: string;
  timestamp: number;
}

export interface BlobRecord {
  id: string;
  sessionId: string;
  tabId?: number;
  frameId?: number;
  blobUrl: string;
  mime?: string;
  size?: number;
  producerApi: string;
  sourceRequestId?: string;
  stackTraceHash?: string;
  createdAt: number;
  revokedAt?: number;
  previewStatus: "available" | "revoked" | "unavailable";
}

export interface AssetBodyRecord {
  assetId: string;
  sessionId: string;
  mime: string;
  bytes: Uint8Array;
  byteLength: number;
  createdAt: number;
}

export interface MediaRecord {
  id: string;
  sessionId: string;
  tabId?: number;
  frameId?: number;
  manifestUrl: string;
  mediaKind: "hls" | "dash" | "progressive" | "unknown";
  playlistType?: string;
  variants?: string[];
  segmentsSeen?: number;
  codecs?: string[];
  resolutions?: string[];
  drmDetected?: boolean;
  nonDownloadableReason?: string;
  createdAt: number;
}

export interface ExportFailure {
  assetId: string;
  url: string;
  reason: string;
}

export interface ExportJob {
  id: string;
  sessionId: string;
  type: "json" | "csv" | "url-list" | "har" | "zip";
  filters: Record<string, string | number | boolean | undefined>;
  selectedIds?: string[];
  startedAt: number;
  completedAt?: number;
  fileCount: number;
  byteCount: number;
  failures: ExportFailure[];
  redactionSummary: string[];
}

export interface SessionSnapshot {
  sessionId: string;
  assets: AssetRecord[];
  blobs: BlobRecord[];
  media: MediaRecord[];
  requests: RequestEvent[];
  deepCaptureAttached: boolean;
  pickerActive?: boolean;
}

export interface ExportResult {
  job: ExportJob;
  filename: string;
  mime: string;
  byteLength: number;
  objectUrl?: string;
}
