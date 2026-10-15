import { FETCH_TIMEOUT_MS } from "./limits";

export async function readResponseBytesCapped(response: Response, limit: number): Promise<Uint8Array> {
  const label = limit >= 1024 * 1024 ? `${Math.round(limit / (1024 * 1024))} MB` : `${limit} bytes`;
  const exceeded = () => new Error(`Asset exceeds ${label} read limit`);
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit) {
    void response.body?.cancel().catch(() => undefined);
    throw exceeded();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw exceeded();
      if (chunks.length >= 1024) throw new Error("Asset exceeds the 1,024-chunk read limit");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchBytesCapped(url: string, limit: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime?: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Asset request timed out after 15 seconds")), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "omit", signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = await readResponseBytesCapped(response, limit);
    controller.signal.throwIfAborted();
    return { bytes, mime: response.headers.get("content-type") ?? undefined };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
