import { describe, expect, it } from "vitest";
import { escapeFilterText } from "@/server/renderers/ffmpeg";
import { parseProbe } from "@/server/renderers/ffprobe";

describe("escapeFilterText", () => {
  it("escapes characters significant to filter graphs", () => {
    expect(escapeFilterText("a:b'c,d;e[f]g\\h")).toBe("a\\:b\\'c\\,d\\;e\\[f\\]g\\\\h");
  });
  it("leaves plain text alone", () => {
    expect(escapeFilterText("Hello world")).toBe("Hello world");
  });
});

describe("parseProbe", () => {
  const json = {
    format: { duration: "2.500000" },
    streams: [
      { codec_type: "video", width: 320, height: 240, avg_frame_rate: "30/1" },
      { codec_type: "audio" },
    ],
  };
  it("extracts duration, dimensions, fps and stream presence", () => {
    expect(parseProbe(json)).toEqual({
      durationSec: 2.5,
      hasVideo: true,
      hasAudio: true,
      width: 320,
      height: 240,
      fps: 30,
    });
  });
  it("handles images/no audio and 0/0 frame rates", () => {
    const info = parseProbe({
      format: {},
      streams: [{ codec_type: "video", width: 10, height: 10, avg_frame_rate: "0/0" }],
    });
    expect(info).toMatchObject({ hasVideo: true, hasAudio: false, durationSec: 0 });
    expect(info.fps).toBeUndefined();
  });
  it("throws on malformed output", () => {
    expect(() => parseProbe({ nope: true })).toThrow();
  });
});
