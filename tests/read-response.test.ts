// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { fetchBytesCapped, readResponseBytesCapped } from "../src/shared/read-response";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("cancels oversized chunked reads without returning a partial file", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); }, cancel
  }));
  await expect(readResponseBytesCapped(response, 3)).rejects.toThrow("read limit");
  expect(cancel).toHaveBeenCalledOnce();
  expect(response.body?.locked).toBe(false);
});

it("cancels a declared oversized body before reading it", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": "100" } });
  await expect(readResponseBytesCapped(response, 3)).rejects.toThrow("read limit");
  expect(cancel).toHaveBeenCalledOnce();
});

it("rejects failed responses and bounds stalled requests with a timeout", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
  await expect(fetchBytesCapped("https://example.com/file.zip", 16)).rejects.toThrow("HTTP 403");
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  })));
  const failed = expect(fetchBytesCapped("https://example.com/slow.zip", 16)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(15_000);
  await failed;
});
