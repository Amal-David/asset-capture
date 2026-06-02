import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
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
  it("builds redacted JSON metadata", async () => {
    const payload = await buildExportPayload("json", "tab-1", [asset], [request]);
    const text = new TextDecoder().decode(payload.bytes);
    expect(text).not.toContain("secret");
    expect(text).toContain("[REDACTED]");
    expect(payload.job.redactionSummary).toContain("query:token");
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
});
