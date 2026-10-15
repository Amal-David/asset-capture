import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExportPayload } from "../src/shared/exporters";
import type { AssetRecord, RequestEvent } from "../src/shared/types";

const asset: AssetRecord = {
  id: "asset-1",
  sessionId: "tab-1",
  tabId: 1,
  url: "https://cdn.example.com/image.png?token=secret",
  kind: "image",
  mime: "image/png",
  extension: "png",
  status: 200,
  size: 1200,
  sources: ["webRequest"],
  previewAvailable: true,
  redactionFlags: [],
  createdAt: 1,
  updatedAt: 2
};

const request: RequestEvent = {
  id: "req-1",
  requestId: "req",
  sessionId: "tab-1",
  tabId: 1,
  phase: "completed",
  url: asset.url,
  method: "GET",
  status: 200,
  requestHeaders: { Authorization: "Bearer nope" },
  responseHeaders: { "content-type": "image/png" },
  timestamp: 1
};

describe("export builders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds redacted JSON metadata", async () => {
    const payload = await buildExportPayload("json", "tab-1", [{ ...asset, initiator: "https://example.com/?token=page-secret" }], [request]);
    const text = new TextDecoder().decode(payload.bytes);
    expect(text).not.toContain("secret");
    expect(text).toContain("[REDACTED]");
    expect(payload.job.redactionSummary).toContain("query:token");
  });

  it("does not turn an explicitly empty selection into an export of everything", async () => {
    const payload = await buildExportPayload("json", "tab-1", [asset], [request], []);
    expect(JSON.parse(new TextDecoder().decode(payload.bytes)).assets).toEqual([]);
    expect(payload.job.fileCount).toBe(0);
  });

  it("builds HAR with redacted headers", async () => {
    const payload = await buildExportPayload("har", "tab-1", [asset], [request]);
    const text = new TextDecoder().decode(payload.bytes);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("Bearer nope");
  });

  it("redacts secrets inside captured text bodies written to the ZIP", async () => {
    const bodies = new Map([
      ["asset-1", { mime: "application/json", bytes: new TextEncoder().encode('{"jwt":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef","ok":true}') }]
    ]);
    const payload = await buildExportPayload("zip", "tab-1", [asset], [], undefined, bodies);
    const files = unzipSync(payload.bytes);
    const body = new TextDecoder().decode(files["assets/image.png"]);
    expect(body).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(body).toContain("[REDACTED]");
  });

  it("records ZIP fetch failures without hiding them", async () => {
    const payload = await buildExportPayload("zip", "tab-1", [{ ...asset, url: "blob:https://example.com/abc" }], []);
    const files = unzipSync(payload.bytes);
    const failures = new TextDecoder().decode(files["failures.json"]);
    expect(failures).toContain("Browser-local URL with no captured bytes");
    expect(payload.job.failures).toHaveLength(1);
  });

  it("caps ZIP fallback fetches so huge uncaptured assets do not buffer in memory", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", {
      status: 200,
      headers: { "content-length": String(17 * 1024 * 1024) }
    })));

    const payload = await buildExportPayload("zip", "tab-1", [{ ...asset, url: "https://cdn.example.com/huge-video.mp4" }], []);
    const files = unzipSync(payload.bytes);
    const failures = new TextDecoder().decode(files["failures.json"]);

    expect(failures).toContain("exceeds 16 MB read limit");
    expect(payload.job.failures).toHaveLength(1);
  });

  it("bounds aggregate ZIP output and records files that do not fit", async () => {
    const bytes = new Uint8Array(16 * 1024 * 1024);
    const assets = Array.from({ length: 5 }, (_, i) => ({ ...asset, id: `asset-${i}`, url: `https://example.com/${i}.png` }));
    const bodies = new Map(assets.map((item) => [item.id, { mime: "image/png", bytes }]));
    const payload = await buildExportPayload("zip", "tab-1", assets, [], undefined, bodies);
    expect(payload.bytes.byteLength).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(payload.job.failures).toHaveLength(2);
    const files = unzipSync(payload.bytes, { filter: (file) => file.name === "failures.json" });
    expect(JSON.parse(new TextDecoder().decode(files["failures.json"])).failures).toHaveLength(2);
  });

  it("rejects oversized selections before fetching and propagates cancellation", async () => {
    const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    await expect(buildExportPayload("zip", "tab-1", Array(257).fill(asset), [])).rejects.toThrow("256 assets");
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    const exportPromise = buildExportPayload("zip", "tab-1", [asset], [], undefined, undefined, controller.signal);
    const rejected = expect(exportPromise).rejects.toThrow("Cancelled by user");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort(new Error("Cancelled by user"));
    await rejected;
  });
});
