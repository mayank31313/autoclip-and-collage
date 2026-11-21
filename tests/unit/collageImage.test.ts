import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/server/http/errors";
import { inspectImage, isSupportedImageMime } from "@/server/analyzers/image/metadata";

const MAX_PIXELS = 1_000;
let dir: string;

async function fixture(name: string, width: number, height: number, orientation?: number) {
  const path = join(dir, name);
  const image = sharp({
    create: { width, height, channels: 3, background: "#336699" },
  });
  const encoded = name.endsWith(".jpg") ? image.jpeg() : image.png();
  await (orientation === undefined ? encoded : encoded.withMetadata({ orientation })).toFile(path);
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "collage-image-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("inspectImage", () => {
  it("reports dimensions, aspect, and pixel count for portrait and landscape images", async () => {
    const tall = await inspectImage(await fixture("tall.png", 2, 3), "a", MAX_PIXELS);
    expect(tall).toEqual({ assetId: "a", widthPx: 2, heightPx: 3, pixelCount: 6 });
    const wide = await inspectImage(await fixture("wide.png", 3, 2), "b", MAX_PIXELS);
    expect(wide).toEqual({ assetId: "b", widthPx: 3, heightPx: 2, pixelCount: 6 });
  });

  it("swaps dimensions for EXIF orientations 5-8", async () => {
    const rotated = await inspectImage(await fixture("o6.jpg", 8, 4, 6), "r", MAX_PIXELS);
    expect(rotated).toMatchObject({ widthPx: 4, heightPx: 8, pixelCount: 32 });
    const upright = await inspectImage(await fixture("o1.jpg", 8, 4, 1), "u", MAX_PIXELS);
    expect(upright).toMatchObject({ widthPx: 8, heightPx: 4 });
  });

  it("rejects malformed input with a sanitized error", async () => {
    const path = join(dir, "bad.png");
    await writeFile(path, "not an image");
    const error = await inspectImage(path, "x", MAX_PIXELS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_FAILED");
    expect((error as AppError).message).not.toContain(dir);
  });

  it("rejects images over the pixel limit", async () => {
    const path = await fixture("big.png", 40, 30);
    const error = await inspectImage(path, "x", 1_000 - 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_FAILED");
    await expect(inspectImage(path, "x", 1_200)).resolves.toMatchObject({ pixelCount: 1_200 });
  });

  it("rejects formats other than JPEG, PNG, and WebP", async () => {
    const path = join(dir, "anim.gif");
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
      .gif()
      .toFile(path);
    await expect(inspectImage(path, "x", MAX_PIXELS)).rejects.toBeInstanceOf(AppError);
  });
});

describe("isSupportedImageMime", () => {
  it("accepts JPEG, PNG, and WebP", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(isSupportedImageMime(type)).toBe(true);
    }
    expect(isSupportedImageMime("video/mp4")).toBe(false);
    expect(isSupportedImageMime("image/gif")).toBe(false);
  });

  it("reports HEIC as supported only when the sharp build encodes and decodes HEVC", async () => {
    const heic = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#f00" },
    })
      .heif({ compression: "hevc" })
      .toBuffer()
      .catch(() => undefined);
    if (heic === undefined) {
      expect(isSupportedImageMime("image/heic")).toBe(false);
      return;
    }
    expect((await sharp(heic).metadata()).width).toBe(8);
    expect(isSupportedImageMime("image/heic")).toBe(true);
  });
});
