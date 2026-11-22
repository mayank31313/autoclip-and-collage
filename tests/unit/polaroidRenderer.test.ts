import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";
import type { PolaroidItem, PolaroidSpec } from "@/lib/schemas/polaroid";
import { renderPolaroidSlides } from "@/server/renderers/polaroid";
import { escapeMarkup } from "@/server/renderers/polaroidPrint";

const FONT = path.resolve("assets/fonts/Caveat-Regular.ttf");
const RENDER_TIMEOUT_MS = 30_000;
const SLIDE_W = 1080;
const RED = [221, 34, 34];
const BLUE = [34, 34, 221];
const SIDE_FRACTION = 0.065;
const DARK_LUMA = 100;

let dir: string;
const sources = new Map<string, string>();

async function solid(name: string, width: number, height: number, rgb: number[]) {
  const [r, g, b] = rgb;
  const file = path.join(dir, `${name}.png`);
  await sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).toFile(file);
  return file;
}

function plan(captions: [string, string] = ["", ""]): PolaroidSpec {
  return planPolaroidCarousel({
    images: [
      { assetId: "a0", caption: captions[0] },
      { assetId: "a1", caption: captions[1] },
    ],
    slideCount: 2,
    slideAspect: "4:5",
  });
}

function polaroid(spec: PolaroidSpec, index: number): PolaroidItem {
  const item = spec.polaroids[index];
  if (!item) throw new Error("missing polaroid");
  return item;
}

const centreOf = (item: PolaroidItem) => ({ cx: item.x + item.w / 2, cy: item.y + item.h / 2 });
const slideOf = (item: PolaroidItem) => Math.floor(centreOf(item).cx / SLIDE_W);

async function render(spec: PolaroidSpec, format: "png" | "jpeg", sub: string) {
  const outputDir = path.join(dir, sub);
  await mkdir(outputDir, { recursive: true });
  return renderPolaroidSlides({ spec, sourcePaths: sources, fontPath: FONT, outputDir, format });
}

async function pixel(file: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return Array.from(data.subarray(offset, offset + 3));
}

/** Counts dark ink pixels in the caption strip of a polaroid, given its slide file. */
async function inkPixels(file: string, item: PolaroidItem): Promise<number> {
  const { cx, cy } = centreOf(item);
  const side = Math.round(item.w * SIDE_FRACTION);
  const stripH = item.h - side - (item.w - 2 * side);
  const stripCentreY = cy + item.h / 2 - stripH / 2;
  const { data, info } = await sharp(file)
    .extract({
      left: Math.round(cx - slideOf(item) * SLIDE_W) - 120,
      top: Math.round(stripCentreY) - 35,
      width: 240,
      height: 70,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma =
      0.299 * (data[i] ?? 255) + 0.587 * (data[i + 1] ?? 255) + 0.114 * (data[i + 2] ?? 255);
    if (luma < DARK_LUMA) dark++;
  }
  return dark;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polaroid-render-"));
  sources.set("a0", await solid("red", 600, 400, RED));
  sources.set("a1", await solid("blue", 300, 500, BLUE));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderPolaroidSlides", () => {
  it(
    "cuts the spread into exact-size PNG slides with each photo in its polaroid",
    async () => {
      const spec = plan();
      const files = await render(spec, "png", "png");
      expect(files.map((f) => path.basename(f))).toEqual(["slide-01.png", "slide-02.png"]);
      for (const file of files) {
        expect(await sharp(file).metadata()).toMatchObject({
          format: "png",
          width: SLIDE_W,
          height: 1350,
        });
      }
      for (const [i, rgb] of [RED, BLUE].entries()) {
        const item = polaroid(spec, i);
        const side = Math.round(item.w * SIDE_FRACTION);
        const photoOffsetY = side + (item.w - 2 * side) / 2 - item.h / 2;
        const { cx, cy } = centreOf(item);
        const slide = slideOf(item);
        const px = await pixel(
          files[slide] ?? "",
          Math.round(cx - slide * SLIDE_W),
          Math.round(cy + photoOffsetY),
        );
        px.forEach((value, c) => expect(Math.abs(value - (rgb[c] ?? 0))).toBeLessThan(12));
      }
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "writes the caption into the strip (escaping markup) and leaves empty strips blank",
    async () => {
      const spec = plan(["Mum & Dad <3", ""]);
      const files = await render(spec, "png", "captions");
      const first = polaroid(spec, 0);
      const second = polaroid(spec, 1);
      expect(await inkPixels(files[slideOf(first)] ?? "", first)).toBeGreaterThan(100);
      expect(await inkPixels(files[slideOf(second)] ?? "", second)).toBe(0);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "encodes JPEG slides when asked",
    async () => {
      const files = await render(plan(), "jpeg", "jpeg");
      expect(files.map((f) => path.extname(f))).toEqual([".jpg", ".jpg"]);
      expect(await sharp(files[0] ?? "").metadata()).toMatchObject({
        format: "jpeg",
        width: SLIDE_W,
        height: 1350,
        channels: 3,
      });
    },
    RENDER_TIMEOUT_MS,
  );

  it("rejects a missing source image", async () => {
    await expect(
      renderPolaroidSlides({
        spec: plan(),
        sourcePaths: new Map(),
        fontPath: FONT,
        outputDir: dir,
        format: "png",
      }),
    ).rejects.toThrow("Missing source image");
  });

  it("rejects an invalid spec", async () => {
    const spec = plan();
    const polaroids = spec.polaroids.map((p, i) => (i === 0 ? { ...p, x: -300 } : p));
    await expect(
      renderPolaroidSlides({
        spec: { ...spec, polaroids },
        sourcePaths: sources,
        fontPath: FONT,
        outputDir: dir,
        format: "png",
      }),
    ).rejects.toThrow();
  });
});

describe("escapeMarkup", () => {
  it("escapes markup syntax and strips control characters", () => {
    expect(escapeMarkup("A & B <3 >")).toBe("A &amp; B &lt;3 &gt;");
    expect(escapeMarkup("a\u0000b\u001fc")).toBe("a b c");
  });
});
