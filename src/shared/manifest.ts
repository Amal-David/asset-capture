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

  for (const match of text.matchAll(/<Representation\b[^>]*>/gi)) {
    const tag = match[0];
    const width = /\bwidth="(\d+)"/i.exec(tag)?.[1];
    const height = /\bheight="(\d+)"/i.exec(tag)?.[1];
    const codec = /\bcodecs="([^"]+)"/i.exec(tag)?.[1];
    const bandwidth = /\bbandwidth="(\d+)"/i.exec(tag)?.[1];
    const resolution = width && height ? `${width}x${height}` : undefined;
    if (resolution) resolutions.add(resolution);
    if (codec) codecs.add(codec);
    variants.push({ resolution, bandwidth: bandwidth ? Number(bandwidth) : undefined, codecs: codec });
  }

  const drmDetected = /<ContentProtection\b/i.test(text);
  return { type: "dash", variants, resolutions: [...resolutions], codecs: [...codecs], drmDetected };
}

export function parseManifest(kind: "hls" | "dash", text: string): ParsedManifest {
  return kind === "hls" ? parseHlsManifest(text) : parseDashManifest(text);
}
