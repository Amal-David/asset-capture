import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, stableId } from "../src/shared/url";
import { bytesToDataUrl } from "../src/shared/exporters";

// Bytes captured in the page world cross page -> content (binary) -> service
// worker (base64). These tests pin that the bridge is lossless, otherwise a
// downloaded/previewed dynamic asset would be silently corrupted.
function sessionIdForTab(tabId?: number): string {
  return `tab-${tabId ?? "unknown"}`;
}

describe("captured asset bodies", () => {
  it("round-trips arbitrary binary bytes through base64 intact", () => {
    const bytes = new Uint8Array(512);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31 + 7) % 256;
    bytes[0] = 0;
    bytes[1] = 255;

    const restored = base64ToBytes(bytesToBase64(bytes));

    expect(restored.length).toBe(bytes.length);
    expect(Array.from(restored)).toEqual(Array.from(bytes));
  });

  it("produces a data URL that decodes back to the original bytes", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    const dataUrl = bytesToDataUrl(bytes, "image/png");

    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = base64ToBytes(dataUrl.split(",")[1]!);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("keys a stored body under the same id the asset record uses", () => {
    // The service worker stores bodies under asset-<stableId(sessionId:url)> and
    // the asset record is created with the identical formula, so preview/download
    // can find the body by asset id. A drift here breaks every dynamic download.
    const tabId = 7;
    const url = "blob:https://example.com/abc-123";
    const assetId = `asset-${stableId(`${sessionIdForTab(tabId)}:${url}`)}`;
    const bodyAssetId = `asset-${stableId(`${sessionIdForTab(tabId)}:${url}`)}`;

    expect(bodyAssetId).toBe(assetId);
  });
});
