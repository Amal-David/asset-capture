import { expect, it } from "vitest";
import { buildHar } from "../src/shared/har";
import type { AssetRecord, RequestEvent } from "../src/shared/types";
import { version } from "../package.json";

it("uses headers from the latest request's phases regardless of snapshot ordering", () => {
  const asset: AssetRecord = {
    id: "asset", sessionId: "tab-1", url: "https://example.com/image.png", kind: "image",
    sources: ["webRequest"], previewAvailable: true, redactionFlags: [], createdAt: 1, updatedAt: 5
  };
  const event = (timestamp: number, phase: RequestEvent["phase"], extra: Partial<RequestEvent> = {}): RequestEvent => ({
    id: String(timestamp), requestId: "current", sessionId: "tab-1", url: asset.url, timestamp, phase, ...extra
  });
  const events = [
    event(5, "completed", { status: 200 }),
    event(4, "headersReceived", { responseHeaders: { "content-type": "image/png" } }),
    event(3, "sendHeaders", { requestHeaders: { Accept: "image/*", Authorization: "secret" } }),
    event(2, "beforeRequest", { method: "GET" }),
    event(1, "completed", { requestId: "old", responseHeaders: { etag: "old" } })
  ];
  for (const requests of [events, [...events].reverse()]) {
    const har = buildHar([asset], requests);
    const entry = har.log.entries[0]!;
    expect(entry.request.headers).toContainEqual({ name: "Accept", value: "image/*" });
    expect(entry.request.headers).toContainEqual({ name: "Authorization", value: "[REDACTED]" });
    expect(entry.response.headers).toEqual([{ name: "content-type", value: "image/png" }]);
    expect(entry.response.status).toBe(200);
    expect(entry.request.httpVersion).toBe("");
    expect(har.log.creator.version).toBe(version);
  }
});
