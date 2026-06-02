import { describe, expect, it } from "vitest";
import { classifyAsset, isGenericMime, isModelViewerCompatible, sniffMimeFromBytes } from "../src/shared/classify";

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}
function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("classifyAsset", () => {
  it("classifies assets from MIME type before extension", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/file.bin", mime: "image/webp" })).toBe("image");
    expect(classifyAsset({ url: "https://cdn.example.com/api", mime: "application/json", resourceType: "xmlhttprequest" })).toBe("api");
  });

  it("classifies media manifests and model files from extensions", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/master.m3u8?token=secret" })).toBe("manifest");
    expect(classifyAsset({ url: "https://cdn.example.com/scene.glb" })).toBe("model");
  });

  it("treats fetch-only unknowns as API payloads", () => {
    expect(classifyAsset({ url: "https://api.example.com/items", sources: ["fetch"] })).toBe("api");
  });

  it("classifies 3D model formats by extension", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/scene.gltf" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/mesh.fbx" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/part.stl" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/cloud.ply" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/asset.meshy" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/print.3mf" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/scene.dae" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/model.usdz" })).toBe("model");
  });

  it("classifies model MIME types", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/file.bin", mime: "model/gltf-binary" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/file", mime: "model/gltf+json" })).toBe("model");
    expect(classifyAsset({ url: "https://cdn.example.com/file", mime: "model/stl" })).toBe("model");
  });

  it("classifies subtitle formats", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/captions.srt" })).toBe("subtitle");
    expect(classifyAsset({ url: "https://cdn.example.com/subs.vtt" })).toBe("subtitle");
    expect(classifyAsset({ url: "https://cdn.example.com/subs.ass" })).toBe("subtitle");
    expect(classifyAsset({ url: "https://cdn.example.com/subs.ttml" })).toBe("subtitle");
  });

  it("classifies additional archive formats", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/file.rar" })).toBe("archive");
    expect(classifyAsset({ url: "https://cdn.example.com/file.7z" })).toBe("archive");
    expect(classifyAsset({ url: "https://cdn.example.com/file.dmg" })).toBe("archive");
  });

  it("classifies additional image formats", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/photo.heic" })).toBe("image");
    expect(classifyAsset({ url: "https://cdn.example.com/photo.jxl" })).toBe("image");
    expect(classifyAsset({ url: "https://cdn.example.com/env.hdr" })).toBe("image");
  });

  it("classifies additional video formats", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/clip.avi" })).toBe("video");
    expect(classifyAsset({ url: "https://cdn.example.com/clip.3gp" })).toBe("video");
  });

  it("classifies additional audio formats", () => {
    expect(classifyAsset({ url: "https://cdn.example.com/track.aac" })).toBe("audio");
    expect(classifyAsset({ url: "https://cdn.example.com/song.midi" })).toBe("audio");
  });

  it("classifies recognized data: and blob: URLs by MIME", () => {
    expect(classifyAsset({ url: "data:image/png;base64,AAAA" })).toBe("image");
    expect(classifyAsset({ url: "blob:https://app.example.com/abc", mime: "video/mp4" })).toBe("video");
  });

  it("terminates (no infinite recursion) on data:/blob: URLs with unrecognized MIME", () => {
    // Regression: a truthy-but-unrecognized MIME used to re-enter the data:/blob:
    // branch forever and overflow the stack, crashing the service worker.
    expect(classifyAsset({ url: "data:text/html,<p>hi</p>" })).toBe("binary");
    expect(classifyAsset({ url: "data:application/pdf;base64,AAAA" })).toBe("binary");
    expect(classifyAsset({ url: "blob:https://app.example.com/xyz", mime: "text/html" })).toBe("binary");
    expect(classifyAsset({ url: "blob:https://app.example.com/xyz" })).toBe("binary");
  });
});

describe("sniffMimeFromBytes", () => {
  it("identifies common binary signatures so mislabeled assets still classify", () => {
    expect(sniffMimeFromBytes(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMimeFromBytes(bytesOf(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMimeFromBytes(bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(sniffMimeFromBytes(bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(sniffMimeFromBytes(bytesOf(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00))).toBe("application/wasm");
    expect(sniffMimeFromBytes(bytesOf(0x77, 0x4f, 0x46, 0x32, 0, 0))).toBe("font/woff2");
    expect(sniffMimeFromBytes(bytesOf(0x67, 0x6c, 0x54, 0x46, 0x02, 0))).toBe("model/gltf-binary");
  });

  it("reads RIFF and ISO-BMFF container brands", () => {
    const webp = new Uint8Array(16);
    webp.set(textBytes("RIFF"), 0);
    webp.set(textBytes("WEBP"), 8);
    expect(sniffMimeFromBytes(webp)).toBe("image/webp");

    const mp4 = new Uint8Array(16);
    mp4.set([0x00, 0x00, 0x00, 0x18], 0);
    mp4.set(textBytes("ftyp"), 4);
    mp4.set(textBytes("isom"), 8);
    expect(sniffMimeFromBytes(mp4)).toBe("video/mp4");

    const avif = new Uint8Array(16);
    avif.set([0x00, 0x00, 0x00, 0x1c], 0);
    avif.set(textBytes("ftyp"), 4);
    avif.set(textBytes("avif"), 8);
    expect(sniffMimeFromBytes(avif)).toBe("image/avif");
  });

  it("detects SVG and JSON text payloads", () => {
    expect(sniffMimeFromBytes(textBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
    expect(sniffMimeFromBytes(textBytes('  {"hello":"world"}'))).toBe("application/json");
  });

  it("returns undefined for unrecognized or too-short input", () => {
    expect(sniffMimeFromBytes(bytesOf(0x12))).toBeUndefined();
    expect(sniffMimeFromBytes(textBytes("just some plain prose that is not an asset"))).toBeUndefined();
  });

  it("detects SVG even when an XML prolog/comment pushes <svg> past byte 64", () => {
    const svg = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- generated by tool -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    expect(svg.indexOf("<svg")).toBeGreaterThan(64);
    expect(sniffMimeFromBytes(textBytes(svg))).toBe("image/svg+xml");
  });

  it("does not mislabel prose-with-brace as JSON or a 0xFFFF blob as mp3", () => {
    expect(sniffMimeFromBytes(textBytes("{this is just a note} not json"))).toBeUndefined();
    expect(sniffMimeFromBytes(bytesOf(0xff, 0xff, 0xff, 0xff))).toBeUndefined();
  });

  it("detects lowercase m4a ftyp brand as audio", () => {
    const m4a = new Uint8Array(16);
    m4a.set([0x00, 0x00, 0x00, 0x18], 0);
    m4a.set(textBytes("ftyp"), 4);
    m4a.set(textBytes("m4a "), 8);
    expect(sniffMimeFromBytes(m4a)).toBe("audio/mp4");
  });

  it("treats missing/octet-stream/text-plain as generic, real types as specific", () => {
    expect(isGenericMime(undefined)).toBe(true);
    expect(isGenericMime("application/octet-stream")).toBe(true);
    expect(isGenericMime("text/plain; charset=utf-8")).toBe(true);
    expect(isGenericMime("image/png")).toBe(false);
  });

  it("lets a sniffed image MIME drive classification end to end", () => {
    const sniffed = sniffMimeFromBytes(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    expect(classifyAsset({ url: "https://cdn.example.com/objects/9f3ab2", mime: sniffed })).toBe("image");
  });
});

describe("isModelViewerCompatible", () => {
  it("returns true for glTF/GLB by extension", () => {
    expect(isModelViewerCompatible("https://cdn.example.com/scene.glb")).toBe(true);
    expect(isModelViewerCompatible("https://cdn.example.com/scene.gltf")).toBe(true);
  });

  it("returns true for glTF MIME types", () => {
    expect(isModelViewerCompatible("https://cdn.example.com/file", "model/gltf-binary")).toBe(true);
    expect(isModelViewerCompatible("https://cdn.example.com/file", "model/gltf+json")).toBe(true);
  });

  it("returns false for other 3D formats", () => {
    expect(isModelViewerCompatible("https://cdn.example.com/mesh.fbx")).toBe(false);
    expect(isModelViewerCompatible("https://cdn.example.com/part.stl")).toBe(false);
    expect(isModelViewerCompatible("https://cdn.example.com/mesh.obj")).toBe(false);
    expect(isModelViewerCompatible("https://cdn.example.com/asset.meshy")).toBe(false);
  });
});
