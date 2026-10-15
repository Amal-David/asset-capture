import type { AssetRecord, RequestEvent } from "./types";
import { redactHeaders, redactUrl } from "./redact";
import { version } from "../../package.json";

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    cookies: [];
    headersSize: -1;
    bodySize: -1;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: [];
    content: {
      size: number;
      mimeType: string;
    };
    redirectURL: string;
    headersSize: -1;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: {
    send: 0;
    wait: number;
    receive: 0;
  };
}

export function buildHar(assets: AssetRecord[], requests: RequestEvent[]) {
  // Index by URL once (O(requests)) so asset correlation is O(1), not a per-asset
  // scan of every request group. Asset and request URLs are both redacted here,
  // so they still match.
  const byUrl = new Map<string, RequestEvent[]>();
  for (const request of requests) {
    const items = byUrl.get(request.url) ?? [];
    items.push(request);
    byUrl.set(request.url, items);
  }

  const entries: HarEntry[] = assets.map((asset) => {
    const related = [...(byUrl.get(asset.url) ?? [])].sort((a, b) => b.timestamp - a.timestamp);
    const last = related[0];
    // Headers arrive in separate phases; only combine phases of the latest
    // request so repeated loads of one URL do not inherit an older response.
    const attempt = related.filter((request) => request.requestId === last?.requestId);
    const responseHeaders = redactHeaders(attempt.find((request) => request.responseHeaders)?.responseHeaders).value ?? {};
    const requestHeaders = redactHeaders(attempt.find((request) => request.requestHeaders)?.requestHeaders).value ?? {};
    const redactedUrl = redactUrl(asset.url).value;
    return {
      startedDateTime: new Date(asset.timing?.startedAt ?? asset.createdAt).toISOString(),
      time: asset.timing?.durationMs ?? 0,
      request: {
        method: asset.method ?? attempt.find((request) => request.method)?.method ?? "GET",
        url: redactedUrl,
        httpVersion: "",
        headers: toHarHeaders(requestHeaders),
        queryString: toHarQuery(redactedUrl),
        cookies: [],
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: asset.status ?? last?.status ?? 0,
        statusText: "",
        httpVersion: "",
        headers: toHarHeaders(responseHeaders),
        cookies: [],
        content: {
          size: asset.size ?? -1,
          mimeType: asset.mime ?? ""
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: asset.size ?? -1
      },
      cache: {},
      timings: {
        send: 0,
        wait: asset.timing?.durationMs ?? 0,
        receive: 0
      }
    };
  });

  return {
    log: {
      version: "1.2",
      creator: {
        name: "Asset Lens",
        version
      },
      entries
    }
  };
}

function toHarHeaders(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function toHarQuery(url: string): Array<{ name: string; value: string }> {
  try {
    const params = new URL(url).searchParams;
    return Array.from(params.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}
