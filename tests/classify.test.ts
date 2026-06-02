import { describe, expect, it } from "vitest";
import { classifyAsset, isModelViewerCompatible } from "../src/shared/classify";

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
