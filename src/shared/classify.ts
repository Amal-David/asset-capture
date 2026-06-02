import type { AssetKind, CaptureSource } from "./types";
import { getExtension } from "./url";

const EXTENSION_KIND: Record<string, AssetKind> = {
  avif: "image",
  bmp: "image",
  gif: "image",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  webp: "image",
  tiff: "image",
  tif: "image",
  jfif: "image",
  apng: "image",
  heic: "image",
  heif: "image",
  jxl: "image",
  hdr: "image",
  exr: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  wmv: "video",
  flv: "video",
  ogv: "video",
  ts: "video",
  m2ts: "video",
  "3gp": "video",
  "3g2": "video",
  f4v: "video",
  mp3: "audio",
  m4a: "audio",
  ogg: "audio",
  opus: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  wma: "audio",
  aiff: "audio",
  aif: "audio",
  mid: "audio",
  midi: "audio",
  amr: "audio",
  ape: "audio",
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  eot: "font",
  json: "json",
  js: "script",
  mjs: "script",
  css: "css",
  wasm: "wasm",
  zip: "archive",
  gz: "archive",
  tar: "archive",
  br: "archive",
  rar: "archive",
  "7z": "archive",
  bz2: "archive",
  xz: "archive",
  zst: "archive",
  iso: "archive",
  dmg: "archive",
  apk: "archive",
  ipa: "archive",
  glb: "model",
  gltf: "model",
  usdz: "model",
  obj: "model",
  fbx: "model",
  stl: "model",
  ply: "model",
  "3mf": "model",
  dae: "model",
  step: "model",
  stp: "model",
  iges: "model",
  igs: "model",
  abc: "model",
  blend: "model",
  meshy: "model",
  srt: "subtitle",
  vtt: "subtitle",
  ass: "subtitle",
  ssa: "subtitle",
  sub: "subtitle",
  dfxp: "subtitle",
  ttml: "subtitle",
  m3u8: "manifest",
  mpd: "manifest",
  pdf: "document"
};

export interface ClassificationInput {
  url: string;
  mime?: string;
  resourceType?: string;
  sources?: CaptureSource[];
}

export function classifyAsset(input: ClassificationInput): AssetKind {
  const mime = input.mime?.split(";")[0]?.trim().toLowerCase();
  const resourceType = input.resourceType?.toLowerCase();
  const extension = getExtension(input.url);

  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("font/")) return "font";
  if (mime === "application/font-woff" || mime === "application/vnd.ms-fontobject") return "font";
  if (mime?.startsWith("model/")) return "model";
  if (mime === "application/json" || mime?.endsWith("+json")) return resourceType === "xmlhttprequest" ? "api" : "json";
  if (mime === "text/css") return "css";
  if (mime === "text/javascript" || mime === "application/javascript") return "script";
  if (mime === "application/wasm") return "wasm";
  if (mime === "application/pdf") return "document";
  if (mime?.includes("mpegurl") || mime === "application/dash+xml") return "manifest";
  if (mime?.includes("zip") || mime?.includes("gzip") || mime?.includes("tar")) return "archive";
  if (mime === "text/vtt" || mime === "application/x-subrip") return "subtitle";

  if (resourceType === "media") return "video";
  if (resourceType === "stylesheet") return "css";
  if (resourceType === "image" || resourceType === "font" || resourceType === "script") return resourceType;

  if (extension && EXTENSION_KIND[extension]) return EXTENSION_KIND[extension];
  if (input.sources?.includes("fetch") || input.sources?.includes("xhr")) return "api";
  if (input.url.startsWith("data:")) return classifyDataUrl(input.url);
  if (input.url.startsWith("blob:")) return classifyByMime(mime);
  return "unknown";
}

function classifyDataUrl(url: string): AssetKind {
  const mime = /^data:([^;,]+)/i.exec(url)?.[1];
  return classifyByMime(mime);
}

// Classify a browser-local URL (data:/blob:) by MIME only. Crucially it passes
// an empty url so the recursive call cannot re-enter the data:/blob: branches —
// a truthy-but-unrecognized MIME (e.g. text/html on a data: iframe) otherwise
// recursed forever and crashed the service worker.
function classifyByMime(mime?: string): AssetKind {
  if (!mime) return "binary";
  const kind = classifyAsset({ url: "", mime });
  return kind === "unknown" ? "binary" : kind;
}

export function isPreviewableKind(kind: AssetKind): boolean {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "font" || kind === "json" || kind === "api" || kind === "manifest" || kind === "model" || kind === "subtitle" || kind === "css" || kind === "document";
}

export function isModelViewerCompatible(url: string, mime?: string): boolean {
  const ext = getExtension(url);
  return ext === "glb" || ext === "gltf" || mime === "model/gltf-binary" || mime === "model/gltf+json";
}

// Image formats a browser <img> can actually decode. We classify HEIC/JXL/EXR/HDR/
// TIFF as "image", but Chrome can't display them — gate those to a download card
// instead of a misleading "failed to load".
const DECODABLE_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg", "apng", "jfif"]);
const DECODABLE_IMAGE_MIME = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "image/bmp", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "image/apng"
]);

export function isBrowserDecodableImage(url: string, mime?: string): boolean {
  const normalized = mime?.split(";")[0]?.trim().toLowerCase();
  if (normalized && DECODABLE_IMAGE_MIME.has(normalized)) return true;
  if (normalized && normalized.startsWith("image/") && !DECODABLE_IMAGE_MIME.has(normalized)) {
    // A specific, known-undisplayable image MIME (heic/heif/jxl/tiff/...).
    return false;
  }
  const ext = getExtension(url);
  if (ext && DECODABLE_IMAGE_EXT.has(ext)) return true;
  // Unknown extension and no decisive MIME: let the render-probe decide.
  return !ext;
}

// MIME types the wire gives us that carry no real signal — for these we trust
// the bytes over the header. Servers routinely mislabel real assets like this.
const GENERIC_MIMES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/download",
  "application/force-download",
  "application/unknown",
  "content/unknown",
  "text/plain",
  "*/*"
]);

export function isGenericMime(mime?: string): boolean {
  if (!mime) return true;
  return GENERIC_MIMES.has(mime.split(";")[0]!.trim().toLowerCase());
}

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  const end = Math.min(start + length, bytes.length);
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

function hasSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

// Intelligent detection: infer a real MIME purely from the leading bytes, so an
// extensionless / generically-typed response (S3-hashed image, /media?id=, an
// API that returns octet-stream) still classifies and previews correctly.
// Covers the dominant binary signatures plus a guarded SVG/JSON text probe.
export function sniffMimeFromBytes(bytes: Uint8Array): string | undefined {
  if (!bytes || bytes.length < 4) return undefined;

  // Images
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasSignature(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (hasSignature(bytes, [0x42, 0x4d])) return "image/bmp";
  if (hasSignature(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";

  // RIFF containers: WEBP image, WAV audio, AVI video
  if (asciiAt(bytes, 0, 4) === "RIFF") {
    const form = asciiAt(bytes, 8, 4);
    if (form === "WEBP") return "image/webp";
    if (form === "WAVE") return "audio/wav";
    if (form === "AVI ") return "video/x-msvideo";
  }

  // ISO-BMFF "ftyp" box: mp4 / avif / heic / quicktime / m4a
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    const brand = asciiAt(bytes, 8, 4).toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    if (["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (brand.startsWith("m4a") || brand.startsWith("m4b")) return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }

  // Fonts
  if (asciiAt(bytes, 0, 4) === "wOF2") return "font/woff2";
  if (asciiAt(bytes, 0, 4) === "wOFF") return "font/woff";
  if (asciiAt(bytes, 0, 4) === "OTTO") return "font/otf";
  if (asciiAt(bytes, 0, 4) === "ttcf") return "font/collection";
  if (hasSignature(bytes, [0x00, 0x01, 0x00, 0x00])) return "font/ttf";

  // 3D
  if (asciiAt(bytes, 0, 4) === "glTF") return "model/gltf-binary";

  // Audio
  if (hasSignature(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg"; // ID3-tagged mp3
  // MPEG audio frame: 11 sync bits + valid version (!=01 reserved), layer (!=00
  // reserved) and bitrate index (1..14) — avoids matching e.g. a 0xFFFF blob.
  if (
    bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 &&
    ((bytes[1]! & 0x18) >> 3) !== 1 && ((bytes[1]! & 0x06) >> 1) !== 0 &&
    ((bytes[2]! >> 4) & 0x0f) >= 1 && ((bytes[2]! >> 4) & 0x0f) <= 14
  ) return "audio/mpeg";
  if (asciiAt(bytes, 0, 4) === "OggS") return "application/ogg";
  if (asciiAt(bytes, 0, 4) === "fLaC") return "audio/flac";

  // Video / matroska
  if (hasSignature(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";

  // Documents / archives / wasm
  if (asciiAt(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (hasSignature(bytes, [0x00, 0x61, 0x73, 0x6d])) return "application/wasm";
  if (hasSignature(bytes, [0x1f, 0x8b])) return "application/gzip";
  if (
    hasSignature(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasSignature(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasSignature(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) return "application/zip";
  if (hasSignature(bytes, [0x42, 0x5a, 0x68])) return "application/x-bzip2";
  if (hasSignature(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "application/x-7z-compressed";
  if (hasSignature(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "application/vnd.rar";

  // Guarded text probe (only meaningful because callers sniff generic MIMEs):
  // detect SVG and JSON, which are very commonly served as octet-stream/text.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
  if (/<svg[\s>]/i.test(head)) return "image/svg+xml";
  // Require a JSON-ish second token so prose beginning with a brace isn't mislabeled.
  if (/^[[{]\s*(["\d\-[\]{}]|true|false|null)/.test(head)) return "application/json";

  return undefined;
}
