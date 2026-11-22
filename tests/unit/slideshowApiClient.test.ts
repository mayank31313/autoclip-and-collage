import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollage } from "@/features/collage/api";
import { buildSlideshowBody } from "@/features/collage/slideshowForm";
import type { CreateCollageBody } from "@/lib/schemas/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(response: Response) {
  const fn = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("slideshow api client", () => {
  it("posts a slideshow body built from mixed image/video sources", async () => {
    const body = buildSlideshowBody(
      {
        canvas: "16:9",
        fps: 24,
        transition: "wipe",
        transitionSec: 1,
        sources: [
          { kind: "image", durationSec: 4, fit: "cover" },
          { kind: "video", fit: "contain" },
        ],
      },
      ["uploads/o/u/a.png", "uploads/o/u/b.mp4"],
    ) satisfies CreateCollageBody;

    const fn = stubFetch(jsonResponse(202, { jobId: "job-1" }));
    const res = await createCollage("ak_test", body);

    expect(res).toEqual({ jobId: "job-1" });
    const [url, init] = fn.mock.calls[0] ?? [];
    expect(url).toBe("/api/collages");
    const sent = JSON.parse(String((init as RequestInit).body)) as unknown;
    expect(sent).toMatchObject({
      mode: "slideshow",
      format: "mp4",
      sources: [
        { key: "uploads/o/u/a.png", kind: "image", durationSec: 4, fit: "cover" },
        { key: "uploads/o/u/b.mp4", kind: "video", fit: "contain" },
      ],
      slideshow: { canvas: "16:9", fps: 24, transition: "wipe", transitionSec: 1 },
    });
  });

  it("rejects a slideshow body with duplicate source keys before sending it", () => {
    expect(() =>
      buildSlideshowBody(
        {
          canvas: "16:9",
          fps: 30,
          transition: "cut",
          transitionSec: 0,
          sources: [
            { kind: "image", durationSec: 3, fit: "cover" },
            { kind: "image", durationSec: 3, fit: "cover" },
          ],
        },
        ["same-key", "same-key"],
      ),
    ).toThrow();
  });
});
