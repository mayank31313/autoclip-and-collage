import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgres://u:p@localhost/d",
  REDIS_URL: "redis://localhost",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "k",
  S3_SECRET_KEY: "s",
  S3_BUCKET: "b",
  API_KEY_PEPPER: "p".repeat(16),
  WEBHOOK_SIGNING_SECRET: "w".repeat(16),
  MAX_IMAGE_UPLOAD_MB: "5",
  MAX_UPLOAD_MB: "5",
  SLIDESHOW_MAX_SLIDES: "5",
  SLIDESHOW_MAX_SLIDE_SEC: "5",
  SLIDESHOW_MAX_DURATION_SEC: "30",
  SLIDESHOW_MAX_TRANSITION_SEC: "2",
});

import { parseProbe } from "@/server/renderers/ffprobe";
import {
  createBuildSlideshowProcessor,
  type BuildSlideshowDeps,
} from "../../worker/processors/buildSlideshow";
import type { RunJobDeps } from "../../worker/runJob";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RENDER_TIMEOUT_MS = 30_000;
const OWNER = "owner-1";

let fixturesDir: string;
let outputsDir: string;
const assetKeys: Record<string, string> = {
  image: "uploads/owner-1/u/photo.png",
  video: "uploads/owner-1/u/clip.mp4",
};

async function ffprobeFile(file: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "--",
    file,
  ]);
  return parseProbe(JSON.parse(stdout));
}

beforeAll(async () => {
  fixturesDir = await mkdtemp(path.join(tmpdir(), "slideshow-fixtures-"));
  outputsDir = await mkdtemp(path.join(tmpdir(), "slideshow-outputs-"));
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 200, g: 60, b: 60 } },
  })
    .png()
    .toFile(path.join(fixturesDir, "photo.png"));
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=15:duration=2",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    path.join(fixturesDir, "clip.mp4"),
  ]);
}, RENDER_TIMEOUT_MS);

afterAll(async () => {
  await rm(fixturesDir, { recursive: true, force: true });
  await rm(outputsDir, { recursive: true, force: true });
});

function harness(overrides: Partial<BuildSlideshowDeps> = {}) {
  const uploads: { key: string; path: string; contentType: string }[] = [];
  const registered: Record<string, unknown>[] = [];
  const row: Record<string, unknown> = {
    id: "intj1",
    ownerId: OWNER,
    status: "queued",
    progress: 0,
    webhookUrl: null,
  };
  const runJobDeps = {
    store: {
      get: async () => ({ ...row }),
      transition: async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
      setProgress: async () => undefined,
    },
    notify: async () => undefined,
  } as unknown as RunJobDeps;

  const deps: Partial<BuildSlideshowDeps> = {
    assetsRepo: {
      getForOwner: async (id: string, ownerId: string) => {
        if (ownerId !== OWNER) return undefined;
        if (id === "img")
          return { id, key: assetKeys.image, kind: "image", contentType: "image/png" };
        if (id === "vid")
          return { id, key: assetKeys.video, kind: "video", contentType: "video/mp4" };
        return undefined;
      },
      register: async (args: Record<string, unknown>) => {
        registered.push(args);
        return { id: `out-${registered.length}`, ...args };
      },
    } as unknown as BuildSlideshowDeps["assetsRepo"],
    downloadObjectToFile: async (key, dest) => {
      const name = key.endsWith(".png") ? "photo.png" : "clip.mp4";
      await copyFile(path.join(fixturesDir, name), dest);
    },
    uploadFile: async (key, filePath, contentType) => {
      const dest = path.join(outputsDir, key.replace(/[/\\]/g, "_"));
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(filePath, dest);
      uploads.push({ key, path: dest, contentType });
      return (await stat(filePath)).size;
    },
    runJobDeps,
    ...overrides,
  };
  const bullJob = (attemptsMade = 0, maxAttempts = 1) =>
    ({
      data: { jobId: "intj1", type: "collage.slideshow" },
      attemptsMade,
      opts: { attempts: maxAttempts },
    }) as unknown as import("bullmq").Job<import("@/lib/schemas/job").JobData>;
  return { row, uploads, registered, bullJob, processor: createBuildSlideshowProcessor(deps) };
}

describe("buildSlideshow processor (real ffmpeg/ffprobe)", () => {
  it(
    "renders a cut slideshow from a real image and video source, uploads a master, slides, and a zip",
    async () => {
      const h = harness();
      const input = {
        sources: [
          { assetId: "img", kind: "image", durationSec: 1, startSec: 0, endSec: 1, fit: "cover" },
          { assetId: "vid", kind: "video", durationSec: 1, startSec: 0, endSec: 1, fit: "cover" },
        ],
        slideshow: { canvas: "16:9", fps: 24, transition: "cut", transitionSec: 0 },
      };
      Object.assign(h.row, { input });
      await h.processor(h.bullJob());

      expect(h.row.status).toBe("succeeded");
      const result = h.row.result as {
        masterAssetId: string;
        zipAssetId: string;
        slideAssetIds: string[];
        width: number;
        height: number;
        fps: number;
        durationSec: number;
      };
      expect(result.slideAssetIds).toHaveLength(2);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.fps).toBe(24);

      const master = h.uploads.find((u) => u.key.endsWith("master.mp4"));
      expect(master).toBeDefined();
      const info = await ffprobeFile(master?.path ?? "");
      expect(info.hasVideo).toBe(true);
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
      expect(info.durationSec).toBeGreaterThan(1.5);
      expect(info.durationSec).toBeLessThan(2.5);

      const slideUploads = h.uploads.filter((u) => /slide-\d+\.mp4$/.test(u.key));
      expect(slideUploads).toHaveLength(2);
      for (const slide of slideUploads) {
        const slideInfo = await ffprobeFile(slide.path);
        expect(slideInfo.hasVideo).toBe(true);
        expect(slideInfo.width).toBe(1920);
        expect(slideInfo.height).toBe(1080);
      }

      const zipUpload = h.uploads.find((u) => u.key.endsWith("slideshow.zip"));
      expect(zipUpload).toBeDefined();
      const entries = unzipSync(await readFile(zipUpload?.path ?? ""));
      expect(Object.keys(entries).sort()).toEqual(
        ["master.mp4", "slide-00.mp4", "slide-01.mp4"].sort(),
      );
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "renders a fade transition master whose duration reflects the crossfade overlap",
    async () => {
      const h = harness();
      const input = {
        sources: [
          {
            assetId: "img",
            kind: "image",
            durationSec: 1.5,
            startSec: 0,
            endSec: 1.5,
            fit: "cover",
          },
          {
            assetId: "vid",
            kind: "video",
            durationSec: 1.5,
            startSec: 0,
            endSec: 1.5,
            fit: "contain",
          },
        ],
        slideshow: { canvas: "1:1", fps: 24, transition: "fade", transitionSec: 0.5 },
      };
      Object.assign(h.row, { input });
      await h.processor(h.bullJob());

      expect(h.row.status).toBe("succeeded");
      const master = h.uploads.find((u) => u.key.endsWith("master.mp4"));
      const info = await ffprobeFile(master?.path ?? "");
      // 1.5 + 1.5 - 0.5 overlap = 2.5s
      expect(info.durationSec).toBeGreaterThan(2.0);
      expect(info.durationSec).toBeLessThan(3.0);
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1080);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    "re-checks runtime limits from Config and fails tampered input before touching ffmpeg",
    async () => {
      const h = harness();
      const input = {
        sources: Array.from({ length: 6 }, () => ({
          assetId: "img",
          kind: "image",
          durationSec: 1,
          startSec: 0,
          endSec: 1,
          fit: "cover",
        })).map((s, i) => ({ ...s, assetId: `img-${i}` })),
        slideshow: { canvas: "16:9", fps: 24, transition: "cut", transitionSec: 0 },
      };
      Object.assign(h.row, { input });
      await expect(h.processor(h.bullJob())).rejects.toThrow();
      expect(h.row.status).toBe("failed");
      expect(h.row.errorCode).toBe("VALIDATION_FAILED");
      expect(h.uploads).toEqual([]);
    },
    RENDER_TIMEOUT_MS,
  );
});
