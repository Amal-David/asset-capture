import { zipSync, strToU8 } from "fflate";
import type { AssetRecord, ExportFailure, ExportJob, RequestEvent } from "./types";
import { buildHar } from "./har";
import { isTextLikeMime, redactHeaders, redactTextContent, redactUrl } from "./redact";
import { bytesToBase64, safeFilename, stableId } from "./url";

// Strip secrets from text-like bodies before they enter an export archive; binary
// bytes pass through untouched.
function redactBodyBytes(bytes: Uint8Array, mime: string | undefined, summary: Set<string>): Uint8Array {
  if (!isTextLikeMime(mime)) return bytes;
  try {
    const { value, flags } = redactTextContent(new TextDecoder().decode(bytes));
    flags.forEach((flag) => summary.add(flag));
    return textBytes(value);
  } catch {
    return bytes;
  }
}

export interface ExportPayload {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  job: ExportJob;
}

export interface CapturedBody {
  mime: string;
  bytes: Uint8Array;
}

export async function buildExportPayload(
  type: ExportJob["type"],
  sessionId: string,
  assets: AssetRecord[],
  requests: RequestEvent[],
  selectedIds?: string[],
  bodies?: Map<string, CapturedBody>
): Promise<ExportPayload> {
  const selected = selectedIds?.length ? assets.filter((asset) => selectedIds.includes(asset.id)) : assets;
  const startedAt = Date.now();
  const failures: ExportFailure[] = [];
  const redactionSummary = new Set<string>();

  const sanitizedAssets = selected.map((asset) => {
    const redacted = redactUrl(asset.url);
    redacted.flags.forEach((flag) => redactionSummary.add(flag));
    return {
      ...asset,
      url: redacted.value,
      originalUrl: undefined,
      redactionFlags: Array.from(new Set([...asset.redactionFlags, ...redacted.flags]))
    };
  });

  let bytes: Uint8Array;
  let filename = `asset-inspector-${sessionId}.${type === "url-list" ? "txt" : type}`;
  let mime = "application/octet-stream";

  if (type === "json") {
    mime = "application/json";
    bytes = textBytes(JSON.stringify({ sessionId, assets: sanitizedAssets }, null, 2));
  } else if (type === "csv") {
    mime = "text/csv";
    bytes = textBytes(buildCsv(sanitizedAssets));
  } else if (type === "url-list") {
    mime = "text/plain";
    bytes = textBytes(sanitizedAssets.map((asset) => asset.url).join("\n"));
  } else if (type === "har") {
    mime = "application/json";
    filename = `asset-inspector-${sessionId}.har`;
    bytes = textBytes(JSON.stringify(buildHar(sanitizedAssets, redactRequestEvents(requests, redactionSummary)), null, 2));
  } else {
    mime = "application/zip";
    bytes = await buildZip(sessionId, selected, sanitizedAssets, requests, failures, redactionSummary, bodies);
  }

  const job: ExportJob = {
    id: `export-${stableId(`${sessionId}:${type}:${startedAt}`)}`,
    sessionId,
    type,
    filters: {},
    selectedIds,
    startedAt,
    completedAt: Date.now(),
    fileCount: selected.length,
    byteCount: bytes.byteLength,
    failures,
    redactionSummary: Array.from(redactionSummary)
  };

  return { filename, mime, bytes, job };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function buildCsv(assets: AssetRecord[]): string {
  const rows = [["id", "kind", "mime", "status", "size", "url", "sources", "redactions"]];
  for (const asset of assets) {
    rows.push([
      asset.id,
      asset.kind,
      asset.mime ?? "",
      String(asset.status ?? ""),
      String(asset.size ?? ""),
      asset.url,
      asset.sources.join("|"),
      asset.redactionFlags.join("|")
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function buildZip(
  sessionId: string,
  originalAssets: AssetRecord[],
  sanitizedAssets: AssetRecord[],
  requests: RequestEvent[],
  failures: ExportFailure[],
  redactionSummary: Set<string>,
  bodies?: Map<string, CapturedBody>
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    "metadata.json": textBytes(JSON.stringify({ sessionId, assets: sanitizedAssets }, null, 2)),
    "requests.har": textBytes(JSON.stringify(buildHar(sanitizedAssets, redactRequestEvents(requests, redactionSummary)), null, 2))
  };

  const usedNames = new Set(Object.keys(files));
  for (const asset of originalAssets) {
    // Prefer bytes already captured in the page world: they cover blob:/auth'd
    // assets and avoid a credentialed re-fetch that could leak cookies/secrets.
    const captured = bodies?.get(asset.id);
    if (captured) {
      const filename = uniqueName(`assets/${safeFilename(asset.url, asset.id)}`, usedNames);
      files[filename] = redactBodyBytes(captured.bytes, captured.mime, redactionSummary);
      continue;
    }

    if (asset.url.startsWith("blob:") || asset.url.startsWith("data:")) {
      failures.push({ assetId: asset.id, url: redactUrl(asset.url).value, reason: "Browser-local URL with no captured bytes; reload the page to capture it." });
      continue;
    }

    try {
      const response = await fetch(asset.url, { credentials: "omit", cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const filename = uniqueName(`assets/${safeFilename(asset.url, asset.id)}`, usedNames);
      const ct = response.headers.get("content-type") ?? asset.mime;
      files[filename] = redactBodyBytes(new Uint8Array(arrayBuffer), ct, redactionSummary);
    } catch (error) {
      failures.push({
        assetId: asset.id,
        url: redactUrl(asset.url).value,
        reason: error instanceof Error ? error.message : "Fetch failed"
      });
    }
  }

  files["failures.json"] = textBytes(JSON.stringify({ failures }, null, 2));
  return zipSync(files, { level: 6 });
}

function redactRequestEvents(requests: RequestEvent[], redactionSummary: Set<string>): RequestEvent[] {
  return requests.map((request) => {
    const url = redactUrl(request.url);
    const requestHeaders = redactHeaders(request.requestHeaders);
    const responseHeaders = redactHeaders(request.responseHeaders);
    [...url.flags, ...requestHeaders.flags, ...responseHeaders.flags].forEach((flag) => redactionSummary.add(flag));
    return {
      ...request,
      url: url.value,
      requestHeaders: requestHeaders.value,
      responseHeaders: responseHeaders.value
    };
  });
}

function textBytes(value: string): Uint8Array {
  return strToU8(value);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function uniqueName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  while (usedNames.has(`${base}-${index}${ext}`)) index += 1;
  const next = `${base}-${index}${ext}`;
  usedNames.add(next);
  return next;
}
