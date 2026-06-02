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
  mpd: "manifest"
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
  if (mime?.includes("mpegurl") || mime === "application/dash+xml") return "manifest";
  if (mime?.includes("zip") || mime?.includes("gzip") || mime?.includes("tar")) return "archive";
  if (mime === "text/vtt" || mime === "application/x-subrip") return "subtitle";

  if (resourceType === "media") return "video";
  if (resourceType === "stylesheet") return "css";
  if (resourceType === "image" || resourceType === "font" || resourceType === "script") return resourceType;

  if (extension && EXTENSION_KIND[extension]) return EXTENSION_KIND[extension];
  if (input.sources?.includes("fetch") || input.sources?.includes("xhr")) return "api";
  if (input.url.startsWith("data:")) return classifyDataUrl(input.url);
  if (input.url.startsWith("blob:")) return mime ? classifyAsset({ url: input.url, mime }) : "binary";
  return "unknown";
}

function classifyDataUrl(url: string): AssetKind {
  const mime = /^data:([^;,]+)/i.exec(url)?.[1];
  return classifyAsset({ url, mime });
}

export function isPreviewableKind(kind: AssetKind): boolean {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "font" || kind === "json" || kind === "api" || kind === "manifest" || kind === "model" || kind === "subtitle" || kind === "css";
}

export function isModelViewerCompatible(url: string, mime?: string): boolean {
  const ext = getExtension(url);
  return ext === "glb" || ext === "gltf" || mime === "model/gltf-binary" || mime === "model/gltf+json";
}
