import { describe, expect, it } from "vitest";
import { parseDashManifest, parseHlsManifest } from "../src/shared/manifest";

describe("parseHlsManifest", () => {
  it("extracts variants, resolutions and codecs from a master playlist", () => {
    const master = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"',
      "720p/index.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028"',
      "1080p/index.m3u8"
    ].join("\n");
    const parsed = parseHlsManifest(master);
    expect(parsed.type).toBe("hls");
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.resolutions).toEqual(expect.arrayContaining(["1280x720", "1920x1080"]));
    expect(parsed.codecs).toContain("avc1.640028");
    expect(parsed.variants[0]?.uri).toBe("720p/index.m3u8");
    expect(parsed.drmDetected).toBe(false);
  });

  it("flags encryption/DRM and counts segments in a media playlist", () => {
    const media = [
      "#EXTM3U",
      "#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://key\"",
      "#EXTINF:6.0,",
      "seg0.ts",
      "#EXTINF:6.0,",
      "seg1.ts"
    ].join("\n");
    const parsed = parseHlsManifest(media);
    expect(parsed.drmDetected).toBe(true);
    expect(parsed.segmentCount).toBe(2);
  });

  it("does not flag DRM when key method is NONE", () => {
    const parsed = parseHlsManifest("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:6.0,\nseg.ts");
    expect(parsed.drmDetected).toBe(false);
  });
});

describe("parseDashManifest", () => {
  it("extracts representations and detects ContentProtection", () => {
    const mpd = `<?xml version="1.0"?><MPD><Period><AdaptationSet>
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"/>
      <Representation id="1" width="1920" height="1080" bandwidth="6000000" codecs="avc1.640028"/>
      <Representation id="2" width="1280" height="720" bandwidth="2000000" codecs="avc1.4d401f"/>
    </AdaptationSet></Period></MPD>`;
    const parsed = parseDashManifest(mpd);
    expect(parsed.type).toBe("dash");
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.resolutions).toEqual(expect.arrayContaining(["1920x1080", "1280x720"]));
    expect(parsed.drmDetected).toBe(true);
  });
});
