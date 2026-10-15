import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { MAX_BODY_BYTES, MAX_ZIP_ASSETS, MAX_ZIP_BYTES } from "./limits";
import { fetchBytesCapped } from "./read-response";
import type { AssetRecord, ExportFailure, ExportJob, RequestEvent } from "./types";
import { buildHar } from "./har";
import { isTextLikeMime, redactHeaders, redactTextContent, redactUrl } from "./redact";
import { bytesToBase64, safeFilename, stableId } from "./url";

// Strip secrets from text-like bodies before they enter an export archive; binary
// bytes pass through untouched.
function redactBodyBytes(bytes: Uint8Array, mime: string | undefined, summary: Set<string>): Uint8Array {
  if (!isTextLikeMime(mime)) return bytes;
  try {
    // Fatal decode: binary mislabeled text/plain throws and passes through
    // byte-for-byte instead of being corrupted by a lossy round-trip.
    const { value, flags } = redactTextContent(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
  bodies?: Map<string, CapturedBody>,
  signal?: AbortSignal
): Promise<ExportPayload> {
  const selection = selectedIds === undefined ? undefined : new Set(selectedIds);
  const selected = selection ? assets.filter((asset) => selection.has(asset.id)) : assets;
  if (type === "zip" && selected.length > MAX_ZIP_ASSETS) throw new Error(`ZIP supports up to ${MAX_ZIP_ASSETS} assets. Select fewer files.`);
  signal?.throwIfAborted();
  const startedAt = Date.now();
  const failures: ExportFailure[] = [];
  const redactionSummary = new Set<string>();

  const sanitizedAssets = selected.map((asset) => {
    const redacted = redactUrl(asset.url);
    const initiator = asset.initiator ? redactUrl(asset.initiator) : undefined;
    const flags = [...redacted.flags, ...(initiator?.flags ?? [])];
    flags.forEach((flag) => redactionSummary.add(flag));
    return {
      ...asset,
      url: redacted.value,
      originalUrl: undefined,
      initiator: initiator?.value,
      redactionFlags: Array.from(new Set([...asset.redactionFlags, ...flags]))
    };
  });

  let bytes: Uint8Array;
  let filename = `asset-lens-${sessionId}.${type === "url-list" ? "txt" : type}`;
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
    filename = `asset-lens-${sessionId}.har`;
    bytes = textBytes(JSON.stringify(buildHar(sanitizedAssets, redactRequestEvents(requests, redactionSummary)), null, 2));
  } else {
    mime = "application/zip";
    bytes = await buildZip(sessionId, selected, sanitizedAssets, requests, failures, redactionSummary, bodies, signal);
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
  bodies?: Map<string, CapturedBody>,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let outputSize = 0;
  let inputSize = 0;
  let archiveError: Error | undefined;
  const budgetError = () => new Error("ZIP exceeds the 64 MB budget. Select fewer files.");
  const archive = new Zip((error, chunk) => {
    if (error) { archiveError = error; throw error; }
    if (outputSize + chunk.byteLength > MAX_ZIP_BYTES) { archiveError = budgetError(); throw archiveError; }
    chunks.push(chunk);
    outputSize += chunk.byteLength;
  });
  const usedNames = new Set<string>();
  const addFile = (name: string, bytes: Uint8Array) => {
    signal?.throwIfAborted();
    if (inputSize + bytes.byteLength > MAX_ZIP_BYTES) throw budgetError();
    inputSize += bytes.byteLength;
    const file = new ZipPassThrough(uniqueName(name, usedNames));
    archive.add(file);
    file.push(bytes, true);
  };
  try {
    addFile("metadata.json", textBytes(JSON.stringify({ sessionId, assets: sanitizedAssets }, null, 2)));
    addFile("requests.har", textBytes(JSON.stringify(buildHar(sanitizedAssets, redactRequestEvents(requests, redactionSummary)), null, 2)));
    for (const asset of originalAssets) {
      signal?.throwIfAborted();
      try {
        const captured = bodies?.get(asset.id);
        // Leave room for the failure report and ZIP directory.
        const remaining = MAX_ZIP_BYTES - inputSize - 1024 * 1024;
        if (remaining <= 0) throw budgetError();
        let bytes: Uint8Array;
        let mime: string | undefined;
        if (captured) {
          if (captured.bytes.byteLength > Math.min(MAX_BODY_BYTES, remaining)) throw budgetError();
          bytes = captured.bytes;
          mime = captured.mime;
        } else {
          if (asset.url.startsWith("blob:") || asset.url.startsWith("data:")) {
            throw new Error("Browser-local URL with no captured bytes; reload the page to capture it.");
          }
          const fetched = await fetchBytesCapped(asset.url, Math.min(MAX_BODY_BYTES, remaining), signal);
          bytes = fetched.bytes;
          mime = fetched.mime ?? asset.mime;
        }
        addFile(`assets/${safeFilename(asset.url, asset.id)}`, redactBodyBytes(bytes, mime, redactionSummary));
      } catch (error) {
        if (archiveError) throw archiveError;
        signal?.throwIfAborted();
        failures.push({ assetId: asset.id, url: redactUrl(asset.url).value, reason: error instanceof Error ? error.message : "Fetch failed" });
      }
      // Yield between files so cancellation and inspector messages can run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    addFile("failures.json", textBytes(JSON.stringify({ failures }, null, 2)));
    archive.end();
    const result = new Uint8Array(outputSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    archive.terminate();
  }
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
