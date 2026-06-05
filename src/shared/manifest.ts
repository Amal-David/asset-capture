// Pure HLS/DASH manifest parsing — extracts adaptive-streaming variants,
// resolutions, codecs and an encryption/DRM flag so the UI can show what a
// stream contains and whether it's downloadable. Regex-based (no DOMParser) so
// it runs identically in the service worker, the sidepanel, and unit tests.

export interface ManifestVariant {
  resolution?: string;
  bandwidth?: number;
  codecs?: string;
  uri?: string;
}

export interface ParsedManifest {
  type: "hls" | "dash";
  variants: ManifestVariant[];
  resolutions: string[];
  codecs: string[];
  drmDetected: boolean;
  segmentCount?: number;
}

export function parseHlsManifest(text: string): ParsedManifest {
  const lines = text.split(/\r?\n/);
  const variants: ManifestVariant[] = [];
  const resolutions = new Set<string>();
  const codecs = new Set<string>();
  let drmDetected = false;
  let segmentCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const resolution = /RESOLUTION=([0-9]+x[0-9]+)/i.exec(line)?.[1];
      const bandwidth = /BANDWIDTH=([0-9]+)/i.exec(line)?.[1];
      const codecList = /CODECS="([^"]+)"/i.exec(line)?.[1];
      if (resolution) resolutions.add(resolution);
      if (codecList) codecList.split(",").forEach((codec) => codecs.add(codec.trim()));
      const next = lines[i + 1]?.trim();
      variants.push({
        resolution,
        bandwidth: bandwidth ? Number(bandwidth) : undefined,
        codecs: codecList,
        uri: next && !next.startsWith("#") ? next : undefined
      });
    } else if (line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY")) {
      const method = /METHOD=([A-Z0-9-]+)/i.exec(line)?.[1];
      if (method && method.toUpperCase() !== "NONE") drmDetected = true;
    } else if (line.startsWith("#EXTINF")) {
      segmentCount += 1;
    }
  }

  return { type: "hls", variants, resolutions: [...resolutions], codecs: [...codecs], drmDetected, segmentCount: segmentCount || undefined };
}

export function parseDashManifest(text: string): ParsedManifest {
  const variants: ManifestVariant[] = [];
  const resolutions = new Set<string>();
  const codecs = new Set<string>();

  const attrs = (tag: string) => ({
    width: /\bwidth="(\d+)"/i.exec(tag)?.[1],
    height: /\bheight="(\d+)"/i.exec(tag)?.[1],
    codecs: /\bcodecs="([^"]+)"/i.exec(tag)?.[1],
    bandwidth: /\bbandwidth="(\d+)"/i.exec(tag)?.[1]
  });

  // In the dominant live/SegmentTemplate profile, width/height/codecs live on the
  // parent <AdaptationSet> while Representations carry only id/bandwidth. Parse each
  // AdaptationSet block and let its Representations inherit the set-level defaults.
  const blocks = [...text.matchAll(/<AdaptationSet\b[^>]*>([\s\S]*?)<\/AdaptationSet>/gi)];
  const scopes = blocks.length ? blocks.map((b) => ({ openTag: b[0].slice(0, b[0].indexOf(">") + 1), inner: b[1] ?? "" })) : [{ openTag: "", inner: text }];

  for (const scope of scopes) {
    const defaults = attrs(scope.openTag);
    const reps = [...scope.inner.matchAll(/<Representation\b[^>]*>/gi)];
    const list = reps.length ? reps.map((r) => r[0]) : (scope.openTag ? [scope.openTag] : []);
    for (const tag of list) {
      const a = attrs(tag);
      const width = a.width ?? defaults.width;
      const height = a.height ?? defaults.height;
      const codec = a.codecs ?? defaults.codecs;
      const resolution = width && height ? `${width}x${height}` : undefined;
      if (resolution) resolutions.add(resolution);
      if (codec) codecs.add(codec);
      variants.push({ resolution, bandwidth: a.bandwidth ? Number(a.bandwidth) : undefined, codecs: codec });
    }
  }

  // Match optional namespace prefix, e.g. <cenc:ContentProtection> / <mas:...>.
  const drmDetected = /<(?:[\w-]+:)?ContentProtection\b/i.test(text);
  return { type: "dash", variants, resolutions: [...resolutions], codecs: [...codecs], drmDetected };
}

export function parseManifest(kind: "hls" | "dash", text: string): ParsedManifest {
  return kind === "hls" ? parseHlsManifest(text) : parseDashManifest(text);
}
