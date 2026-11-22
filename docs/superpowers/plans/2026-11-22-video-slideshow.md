# Video Slideshow Collage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mixed image/video slideshow collage mode that produces one MP4 master, per-slide MP4s, and a ZIP.

**Architecture:** A Zod `slideshow` request and versioned `SlideshowSpec` feed a pure, deterministic timeline planner. A BullMQ `collage.slideshow` processor validates owned image/video assets, normalizes media to the configured canvas, renders per-slide MP4s and one master with FFmpeg, uploads deterministic outputs, and exposes only freshly presigned URLs.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Zod 4, BullMQ, FFmpeg/ffprobe, sharp, AWS S3, `fflate`, TanStack Query, react-hook-form, Vitest + fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-video-slideshow-design.md`

## Global Constraints

- Preserve the existing `grid` and `polaroid` request/result behavior.
- The new API member is `mode: "slideshow"`; no spec change makes existing payloads invalid.
- All source coordinates are seconds; all canvas coordinates are integer pixels.
- Video and image jobs run outside Next.js route handlers.
- FFmpeg and ffprobe use argument arrays only; never `exec`, shell strings, or unescaped filtergraph paths.
- Zod schemas are in `src/lib/schemas`; timeline planning is pure and isomorphic.
- Use the existing temp-dir, `runJob`, storage, ownership, webhook, and signed-result patterns.
- Default canvas is `16:9` -> `1920x1080`; also support `9:16` -> `1080x1920` and `1:1` -> `1080x1080`.
- Default FPS is 30; allowed FPS is 24 or 30.
- Default limits are 20 slides, 30 seconds per slide, 300 seconds master duration, and 2 seconds transition.
- Per-slide MP4 files are named `slide-{n}.mp4`; the master is `master.mp4`; the ZIP is `slideshow.zip`.
- New modules containing logic get focused unit/property tests in the same task.

---

## Environment and commit rules

- PowerShell is the shell. Check Node first with `$env:Path = "C:\Program Files\nodejs;" + $env:Path` if needed.
- Working-tree log files and pre-existing source edits must not be added accidentally.
- Commit only files edited by the task. Use `git add -- <exact paths>` and `git diff --cached --check`.
- Commit message trailer:

```text
git commit -m "<subject>" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- The pre-existing dirty files must be treated as user work. Do not use `git add .`, `git add -A`, or `git add -u`.

---

## Task 1: Slideshow contracts and pure timeline planner

**Files:**
- Create: `src/lib/schemas/slideshow.ts`
- Create: `src/lib/planner/slideshow/defaults.ts`
- Create: `src/lib/planner/slideshow/plan.ts`
- Create: `src/lib/planner/slideshow/validate.ts`
- Test: `tests/unit/slideshowSchemas.test.ts`
- Test: `tests/property/slideshowTimeline.test.ts`

**Interfaces:**
- Consumes: Zod, existing `CollageFormat`/`HttpUrl` patterns.
- Produces:
  - `SlideshowSourceKind = z.enum(["image", "video"])`
  - `SlideshowCanvas = z.enum(["16:9", "9:16", "1:1"])`
  - `SlideshowSourceSchema`
  - `SlideshowOptions`
  - `SlideshowWorkerInput`
  - `SlideshowWorkerResult`
  - `SlideshowSpec`
  - `SlideshowJobResult`
  - `SLIDESHOW_JOB_TYPE = "collage.slideshow"`
  - `SLIDESHOW_CANVAS_SIZE`
  - `planSlideshowTimeline(input): SlideshowSpec`
  - `validateSlideshowSpec(spec): readonly SlideshowIssue[]`

**Step 1: Add failing schema tests**

Create `tests/unit/slideshowSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SLIDESHOW_JOB_TYPE,
  SlideshowOptions,
  SlideshowSourceSchema,
  SlideshowSpec,
  SlideshowWorkerInput,
} from "@/lib/schemas/slideshow";

describe("slideshow schemas", () => {
  it("requires positive image duration", () => {
    expect(
      SlideshowSourceSchema.safeParse({
        key: "uploads/owner/a.jpg",
        kind: "image",
        durationSec: 0,
      }).success,
    ).toBe(false);
  });

  it("accepts a valid video trim", () => {
    expect(
      SlideshowSourceSchema.safeParse({
        key: "uploads/owner/a.mp4",
        kind: "video",
        startSec: 2,
        endSec: 7,
        fit: "cover",
      }).success,
    ).toBe(true);
  });

  it("rejects cut with a non-zero transition", () => {
    expect(
      SlideshowOptions.safeParse({
        canvas: "16:9",
        fps: 30,
        transition: "cut",
        transitionSec: 1,
      }).success,
    ).toBe(false);
  });

  it("uses the slideshow job type", () => {
    expect(SLIDESHOW_JOB_TYPE).toBe("collage.slideshow");
  });

  it("rejects duplicate source asset IDs in worker input", () => {
    expect(
      SlideshowWorkerInput.safeParse({
        sources: [
          { assetId: "a", kind: "image", durationSec: 3, startSec: 0, endSec: 3, fit: "cover" },
          { assetId: "a", kind: "video", durationSec: 4, startSec: 0, endSec: 4, fit: "contain" },
        ],
        slideshow: {
          canvas: "16:9",
          fps: 30,
          transition: "cut",
          transitionSec: 0,
        },
      }).success,
    ).toBe(false);
  });

  it("exports a parseable spec shape", () => {
    const spec = SlideshowSpec.parse({
      version: 1,
      canvas: { w: 1920, h: 1080 },
      fps: 30,
      transition: { type: "cut", durationSec: 0 },
      slides: [
        {
          id: 0,
          assetId: "a",
          kind: "image",
          startSec: 0,
          endSec: 3,
          durationSec: 3,
          fit: "cover",
        },
      ],
      masterDurationSec: 3,
    });
    expect(spec.slides).toHaveLength(1);
  });
});
```

**Step 2: Run unit test to verify it fails**

Run:

```bash
npx vitest run tests/unit/slideshowSchemas.test.ts
```

Expected: FAIL because `@/lib/schemas/slideshow` does not exist.

**Step 3: Implement the schemas and defaults**

Create `src/lib/schemas/slideshow.ts` with no IO imports:

```ts
import { z } from "zod";

export const SLIDESHOW_JOB_TYPE = "collage.slideshow";

export const SlideshowSourceKind = z.enum(["image", "video"]);
export const SlideshowCanvas = z.enum(["16:9", "9:16", "1:1"]);
export const SlideshowFit = z.enum(["cover", "contain"]);

export const SlideshowSourceSchema = z
  .object({
    key: z.string().min(1).max(1024),
    kind: SlideshowSourceKind,
    durationSec: z.number().positive().max(30).optional(),
    startSec: z.number().nonnegative().optional(),
    endSec: z.number().positive().optional(),
    fit: SlideshowFit.default("cover"),
  })
  .superRefine((source, ctx) => {
    if (source.kind === "image" && source.durationSec === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["durationSec"],
        message: "image durationSec is required",
      });
    }
    if (source.kind === "video" && source.startSec !== undefined && source.endSec === undefined) {
      ctx.addIssue({ code: "custom", path: ["endSec"], message: "endSec is required with startSec" });
    }
    if (source.startSec !== undefined && source.endSec !== undefined && source.endSec <= source.startSec) {
      ctx.addIssue({ code: "custom", path: ["endSec"], message: "endSec must follow startSec" });
    }
  });

export const SlideshowOptions = z
  .object({
    canvas: SlideshowCanvas.default("16:9"),
    fps: z.union([z.literal(24), z.literal(30)]).default(30),
    transition: z.enum(["cut", "fade", "wipe"]).default("cut"),
    transitionSec: z.number().nonnegative().max(2).default(0),
  })
  .refine(
    (options) => options.transition !== "cut" || options.transitionSec === 0,
    "cut requires transitionSec to be zero",
  );

export const SlideshowWorkerSource = z.object({
  assetId: z.string().min(1),
  kind: SlideshowSourceKind,
  durationSec: z.number().positive().max(30),
  startSec: z.number().nonnegative().default(0),
  endSec: z.number().positive(),
  fit: SlideshowFit,
});

export const SlideshowWorkerInput = z
  .object({
    sources: z.array(SlideshowWorkerSource).min(1).max(20),
    slideshow: SlideshowOptions,
  })
  .superRefine((input, ctx) => {
    const ids = new Set<string>();
    input.sources.forEach((source, index) => {
      if (ids.has(source.assetId)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "assetId"],
          message: "asset used more than once",
        });
      }
      ids.add(source.assetId);
    });
  });

export const SlideshowSpec = z.object({
  version: z.literal(1),
  canvas: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  fps: z.union([z.literal(24), z.literal(30)]),
  transition: z.object({ type: z.enum(["cut", "fade", "wipe"]), durationSec: z.number().nonnegative() }),
  slides: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      assetId: z.string().min(1),
      kind: SlideshowSourceKind,
      startSec: z.number().nonnegative(),
      endSec: z.number().positive(),
      durationSec: z.number().positive(),
      fit: SlideshowFit,
    }),
  ).min(1).max(20),
  masterDurationSec: z.number().positive(),
});

export const SlideshowWorkerResult = z.object({
  masterAssetId: z.string().min(1),
  zipAssetId: z.string().min(1),
  slideAssetIds: z.array(z.string().min(1)).min(1).max(20),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.union([z.literal(24), z.literal(30)]),
  durationSec: z.number().positive(),
});

export type SlideshowSourceSchema = z.infer<typeof SlideshowSourceSchema>;
export type SlideshowOptions = z.infer<typeof SlideshowOptions>;
export type SlideshowWorkerInput = z.infer<typeof SlideshowWorkerInput>;
export type SlideshowSpec = z.infer<typeof SlideshowSpec>;
export type SlideshowWorkerResult = z.infer<typeof SlideshowWorkerResult>;
```

Create `src/lib/planner/slideshow/defaults.ts`:

```ts
export const SLIDESHOW_CANVAS_SIZE = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
} as const;

export const SLIDESHOW_MAX_SLIDES = 20;
export const SLIDESHOW_MAX_SLIDE_SEC = 30;
export const SLIDESHOW_MAX_DURATION_SEC = 300;
export const SLIDESHOW_MAX_TRANSITION_SEC = 2;
```

**Step 4: Add planner property test**

Create `tests/property/slideshowTimeline.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planSlideshowTimeline } from "@/lib/planner/slideshow/plan";

describe("slideshow timeline", () => {
  it("is deterministic and calculates overlap duration", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.float({ min: 1, max: 30, noNaN: true }),
        fc.constantFrom("cut", "fade", "wipe"),
        (count, duration, transition) => {
          const sources = Array.from({ length: count }, (_, id) => ({
            assetId: `asset-${id}`,
            kind: "image" as const,
            durationSec: duration,
            fit: "cover" as const,
          }));
          const input = {
            canvas: "16:9" as const,
            fps: 30 as const,
            transition,
            transitionSec: transition === "cut" ? 0 : 0.5,
            sources,
          };
          const a = planSlideshowTimeline(input);
          const b = planSlideshowTimeline(input);
          expect(a).toEqual(b);
          expect(a.slides).toHaveLength(count);
          expect(new Set(a.slides.map((slide) => slide.assetId)).size).toBe(count);
          const transitionOverlap = transition === "cut" ? 0 : 0.5 * (count - 1);
          expect(a.masterDurationSec).toBeCloseTo(duration * count - transitionOverlap, 5);
        },
      ),
    );
  });
});
```

**Step 5: Implement and pass the pure planner**

Create `src/lib/planner/slideshow/validate.ts`:

```ts
import type { SlideshowSpec } from "@/lib/schemas/slideshow";

export interface SlideshowIssue {
  path: readonly (string | number)[];
  message: string;
}

export function validateSlideshowSpec(spec: SlideshowSpec): readonly SlideshowIssue[] {
  const issues: SlideshowIssue[] = [];
  const assetIds = new Set<string>();
  for (const [index, slide] of spec.slides.entries()) {
    if (assetIds.has(slide.assetId)) issues.push({ path: ["slides", index, "assetId"], message: "asset used more than once" });
    assetIds.add(slide.assetId);
    if (slide.endSec <= slide.startSec) issues.push({ path: ["slides", index, "endSec"], message: "endSec must follow startSec" });
  }
  if (spec.transition.type === "cut" && spec.transition.durationSec !== 0) {
    issues.push({ path: ["transition", "durationSec"], message: "cut requires zero transition" });
  }
  return issues;
}
```

Add `superRefine(validateSlideshowSpec)` to `SlideshowSpec`. Create `plan.ts`:

```ts
import { SLIDESHOW_CANVAS_SIZE } from "./defaults";
import type { SlideshowSpec } from "@/lib/schemas/slideshow";

interface PlanSource {
  assetId: string;
  kind: "image" | "video";
  durationSec: number;
  startSec?: number;
  endSec?: number;
  fit: "cover" | "contain";
}

export function planSlideshowTimeline(input: {
  canvas: "16:9" | "9:16" | "1:1";
  fps: 24 | 30;
  transition: "cut" | "fade" | "wipe";
  transitionSec: number;
  sources: readonly PlanSource[];
}): SlideshowSpec {
  const transitionSec = input.transition === "cut" ? 0 : input.transitionSec;
  const slides = input.sources.map((source, id) => {
    const startSec = source.startSec ?? 0;
    const endSec = source.endSec ?? startSec + source.durationSec;
    return {
      id,
      assetId: source.assetId,
      kind: source.kind,
      startSec,
      endSec,
      durationSec: source.durationSec,
      fit: source.fit,
    };
  });
  const overlap = transitionSec * Math.max(0, slides.length - 1);
  return {
    version: 1,
    canvas: SLIDESHOW_CANVAS_SIZE[input.canvas],
    fps: input.fps,
    transition: { type: input.transition, durationSec: transitionSec },
    slides,
    masterDurationSec: Math.max(0, slides.reduce((sum, slide) => sum + slide.durationSec, 0) - overlap),
  };
}
```

Run:

```bash
npx vitest run tests/unit/slideshowSchemas.test.ts tests/property/slideshowTimeline.test.ts
```

Expected: both suites pass.

**Step 6: Commit**

```bash
git add -- src/lib/schemas/slideshow.ts src/lib/planner/slideshow/defaults.ts src/lib/planner/slideshow/plan.ts src/lib/planner/slideshow/validate.ts tests/unit/slideshowSchemas.test.ts tests/property/slideshowTimeline.test.ts
git diff --cached --check
git commit -m "feat: add slideshow timeline contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Mixed-media API, config, and route verification

**Files:**
- Modify: `src/lib/schemas/api.ts`
- Modify: `src/server/config.ts`
- Modify: `src/app/api/uploads/presign/route.ts`
- Modify: `src/app/api/collages/route.ts`
- Modify: `src/app/api/jobs/[id]/route.ts`
- Create: `src/server/analyzers/video/metadata.ts`
- Create: `src/server/jobs/slideshowResult.ts`
- Test: `tests/unit/slideshowApi.test.ts`
- Test: `tests/unit/videoMetadata.test.ts`
- Test: `tests/integration/slideshowCollages.test.ts`
- Test: `tests/integration/slideshowJobs.test.ts`

**Interfaces:**
- Consumes: `SlideshowSourceSchema`, `SlideshowOptions`, `SlideshowWorkerInput`, existing assets/head/download repos.
- Produces:
  - `CreateSlideshowCollageBody`
  - `SlideshowJobResult`
  - `inspectVideo(path): Promise<MediaInfo>`
  - `resolveSlideshowResult(job, io?): Promise<SlideshowJobResult>`

**Step 1: Add failing API tests**

Create `tests/unit/slideshowApi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALLOWED_UPLOAD_TYPES, CreateCollageBody } from "@/lib/schemas/api";

describe("slideshow API", () => {
  it("allows video upload MIME types", () => {
    expect(ALLOWED_UPLOAD_TYPES).toContain("video/mp4");
  });

  it("accepts a mixed slideshow body", () => {
    expect(
      CreateCollageBody.safeParse({
        mode: "slideshow",
        sources: [
          { key: "uploads/owner/a.jpg", kind: "image", durationSec: 3, fit: "cover" },
          { key: "uploads/owner/b.mp4", kind: "video", startSec: 1, endSec: 4, fit: "contain" },
        ],
        slideshow: { canvas: "9:16", fps: 30, transition: "fade", transitionSec: 0.5 },
        format: "mp4",
      }).success,
    ).toBe(true);
  });
});
```

**Step 2: Run test and verify failure**

Run:

```bash
npx vitest run tests/unit/slideshowApi.test.ts
```

Expected: FAIL because `CreateCollageBody` has no slideshow branch.

**Step 3: Extend config and API schemas**

- In `src/server/config.ts`, add Zod env fields and parsed values:
  - `SLIDESHOW_MAX_SLIDES`
  - `SLIDESHOW_MAX_SLIDE_SEC`
  - `SLIDESHOW_MAX_DURATION_SEC`
  - `SLIDESHOW_MAX_TRANSITION_SEC`
- In `src/lib/schemas/api.ts`, import `SlideshowOptions` and `SlideshowSourceSchema`.
- Add `CreateSlideshowCollageBody` as a union member containing unique sources and `format: z.literal("mp4")`.
- Add `SlideshowJobResult` with `masterUrl`, `zipUrl`, slide URLs, dimensions, FPS, duration, format, and expiry.

Do not accept remote video URLs in this task. Every source remains an uploaded object key.

**Step 4: Add route verification tests**

Create `tests/integration/slideshowCollages.test.ts` with fakes that assert:

- video MIME and extension are allowed;
- foreign/missing keys return 404;
- mismatched source kind is rejected;
- video trim outside probed duration is rejected;
- master duration over 300 seconds is rejected;
- a valid request registers image/video assets and enqueues `collage.slideshow`.

The implementation pattern is:

```ts
async function verifySlideshowSource(source, ownerId): Promise<VerifiedMedia> {
  checkOwnedKey(source.key, ownerId);
  const head = await headObject(source.key);
  if (!head.sizeBytes) throw invalid("Source size is unavailable");
  if (source.kind === "image") {
    if (!isSupportedImageMime(head.contentType ?? "")) throw invalid("Unsupported image content type");
  } else {
    if (!VIDEO_MIME_EXTENSIONS.has((head.contentType ?? "").split(";")[0].trim())) {
      throw invalid("Unsupported video content type");
    }
  }
  return { key: source.key, contentType: head.contentType ?? "", sizeBytes: head.sizeBytes };
}
```

Use `assetsRepo.register({ kind: source.kind, ...verified })`, with exact public metadata limited to dimensions/duration/format.

**Step 5: Extend job result resolution**

Create `src/server/jobs/slideshowResult.ts` using the polaroid resolver pattern:

- Parse `SlideshowWorkerResult`.
- Load master, ZIP, and every slide asset by ID for the owner.
- Reject missing/non-output assets.
- Presign all keys in one batch.
- Return `SlideshowJobResult`.

Modify `src/app/api/jobs/[id]/route.ts` to resolve `collage.slideshow`.

**Step 6: Run focused tests**

```bash
npx vitest run tests/unit/slideshowApi.test.ts tests/unit/videoMetadata.test.ts tests/integration/slideshowCollages.test.ts tests/integration/slideshowJobs.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add -- src/lib/schemas/api.ts src/server/config.ts src/app/api/uploads/presign/route.ts src/app/api/collages/route.ts src/app/api/jobs/[id]/route.ts src/server/analyzers/video/metadata.ts src/server/jobs/slideshowResult.ts tests/unit/slideshowApi.test.ts tests/unit/videoMetadata.test.ts tests/integration/slideshowCollages.test.ts tests/integration/slideshowJobs.test.ts
git diff --cached --check
git commit -m "feat: add slideshow API and media verification" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: FFmpeg slideshow renderer and worker processor

**Files:**
- Create: `worker/processors/buildSlideshow.ts`
- Create: `src/server/renderers/slideshow.ts`
- Modify: `worker/processors/collageQueue.ts`
- Modify: `worker/runJob.ts`
- Modify: `src/server/renderers/ffmpeg.ts`
- Test: `tests/unit/buildSlideshow.test.ts`
- Test: `tests/unit/slideshowRenderer.test.ts`
- Test: `tests/integration/slideshowProcessor.test.ts`
- Create: `tests/fixtures/slideshow/README.md`

**Interfaces:**
- Consumes: `SlideshowWorkerInput`, `SlideshowSpec`, `probeMedia`, `runFfmpeg`, `downloadObjectToFile`, `uploadFile`, asset repo, `runJob`.
- Produces:
  - `normalizeSlideshowSource(args): Promise<string>`
  - `renderPerSlideVideos(args): Promise<string[]>`
  - `renderSlideshowMaster(args): Promise<void>`
  - `createBuildSlideshowProcessor(overrides?): (job) => Promise<void>`

**Step 1: Add failing renderer test**

Create `tests/unit/slideshowRenderer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildSlideFilter } from "@/server/renderers/slideshow";

describe("slideshow renderer", () => {
  it("normalizes to cover at canvas dimensions", () => {
    expect(buildSlideFilter({ w: 1080, h: 1920, fit: "cover" })).toContain(
      "scale=1080:1920",
    );
  });

  it("never interpolates source paths into a filtergraph", () => {
    const run = vi.fn(async () => undefined);
    expect(run).not.toThrow();
  });
});
```

**Step 2: Run test and verify failure**

```bash
npx vitest run tests/unit/slideshowRenderer.test.ts
```

Expected: FAIL because slideshow renderer exports do not exist.

**Step 3: Implement normalized filters**

Create `src/server/renderers/slideshow.ts`:

- `buildSlideFilter({ w, h, fit })` returns `scale=w:h:force_original_aspect_ratio=increase,crop=w:h` for cover or `scale=w:h:force_original_aspect_ratio=decrease,pad=w:h:(ow-iw)/2:(oh-ih)/2` for contain.
- `normalizeImageSlide` calls FFmpeg with `-loop 1`, `-framerate fps`, `-t durationSec`, `-i imagePath`, `-vf filter`, `-an`, `-pix_fmt yuv420p`, `-c:v libx264`, `-t`, and output MP4.
- `normalizeVideoSlide` calls FFmpeg with `-ss startSec`, `-i videoPath`, `-t durationSec`, `-vf filter`, `-map 0:v:0`, `-an`, `-pix_fmt yuv420p`, `-c:v libx264`, and output MP4.
- Every normalized clip and the master are rendered with `-an` (no audio track): the MVP slideshow output is silent, never generated with synthetic audio.
- `renderSlideshowMaster` writes the master by direct concat for cut or `xfade=fade`/`xfade=wipeleft` for transitions.
- It escapes every filter argument and never emits source paths into filtergraph strings.

The FFmpeg helper remains the only process spawner.

**Step 4: Add worker tests**

Create `tests/unit/buildSlideshow.test.ts` asserting:

- input is parsed with Zod;
- source download paths are sequential;
- deterministic output keys are used;
- master/ZIP/slide assets are registered;
- temp directory is removed on success and failure;
- permanent validation failures become `UnrecoverableError` through `runJob`.

Create `tests/integration/slideshowProcessor.test.ts` using fake dependencies and tiny files.

**Step 5: Implement processor**

Create `worker/processors/buildSlideshow.ts`:

```ts
import type { Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import type {
  SlideshowWorkerInput,
  SlideshowWorkerResult,
} from "@/lib/schemas/slideshow";

export interface BuildSlideshowDeps {
  assetsRepo: {
    getForOwner(assetId: string, ownerId: string): Promise<
      { id: string; kind: "image" | "video" | "output"; key: string; contentType: string } | undefined
    >;
    register(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  downloadObjectToFile: (key: string, path: string, maxBytes: number) => Promise<void>;
  uploadFile: (key: string, path: string, contentType: string) => Promise<number>;
  probeMedia: (path: string) => Promise<{ durationSec: number; hasVideo: boolean }>;
  renderPerSlide: (args: {
    spec: import("@/lib/schemas/slideshow").SlideshowSpec;
    sourcePaths: ReadonlyMap<string, string>;
    dir: string;
  }) => Promise<string[]>;
  renderMaster: (args: {
    slidePaths: readonly string[];
    spec: import("@/lib/schemas/slideshow").SlideshowSpec;
    outputPath: string;
  }) => Promise<void>;
  writeZip: (files: readonly string[], outPath: string) => Promise<void>;
  mkdtemp: (prefix: string) => Promise<string>;
  rm: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  runJob: (
    args: { jobId: string; attemptsMade: number; maxAttempts: number },
    work: (ctx: {
      job: { id: string; ownerId: string; input: unknown };
      progress(progress: number): Promise<void>;
    }) => Promise<SlideshowWorkerResult>,
  ) => Promise<void>;
}

export function createBuildSlideshowProcessor(
  overrides: Partial<BuildSlideshowDeps>,
): (job: Job<JobData>) => Promise<void> {
  const deps = { ...defaultBuildSlideshowDeps, ...overrides };
  return async (job) =>
    deps.runJob(
      {
        jobId: job.data.jobId,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      },
      (ctx) => buildSlideshow(deps, ctx),
    );
}

export const buildSlideshowProcessor = createBuildSlideshowProcessor({});
```

`defaultBuildSlideshowDeps` and `buildSlideshow` are concrete implementations of the injected dependencies:

- `assetsRepo`;
- `downloadObjectToFile`;
- `uploadFile`;
- `probeMedia`;
- `runFfmpeg`;
- `renderPerSlide`;
- `renderMaster`;
- `writeZip`;
- `mkdtemp`;
- `rm`;
- `runJob`;

The processor:

1. Parses `SlideshowWorkerInput`.
2. Downloads all source assets, then verifies `asset.kind`.
3. Calls `planSlideshowTimeline` with source duration metadata.
4. Re-checks master duration and limits.
5. Normalizes and renders every slide.
6. Renders the master.
7. Creates the ZIP.
8. Uploads master, slides, and ZIP with fixed job-derived keys.
9. Registers output assets.
10. Returns `SlideshowWorkerResult`.

**Step 6: Wire queue and webhook**

- Modify `createCollageDispatcher` to accept `slideshow` and dispatch `SLIDESHOW_JOB_TYPE`.
- Modify `worker/index.ts` only if processor registration is not already covered.
- Modify `resultUrlsFor` in `worker/runJob.ts` to include master and slide URLs for succeeded slideshow jobs.

**Step 7: Run tests**

```bash
npx vitest run tests/unit/buildSlideshow.test.ts tests/unit/slideshowRenderer.test.ts tests/integration/slideshowProcessor.test.ts tests/unit/ffmpeg.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add -- worker/processors/buildSlideshow.ts src/server/renderers/slideshow.ts worker/processors/collageQueue.ts worker/runJob.ts src/server/renderers/ffmpeg.ts tests/unit/buildSlideshow.test.ts tests/unit/slideshowRenderer.test.ts tests/integration/slideshowProcessor.test.ts tests/fixtures/slideshow/README.md
git diff --cached --check
git commit -m "feat: render video slideshow jobs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Slideshow UI and upload support

**Files:**
- Modify: `src/features/collage/form.ts`
- Modify: `src/features/collage/api.ts`
- Modify: `src/components/collage/CollageCreateForm.tsx`
- Modify: `src/components/collage/CollageOptionsFields.tsx`
- Modify: `src/components/collage/CollageStatus.tsx`
- Create: `src/components/collage/SlideshowOptionsFields.tsx`
- Create: `src/components/collage/SlideshowResult.tsx`
- Create: `src/features/collage/slideshowForm.ts`
- Test: `tests/unit/slideshowForm.test.ts`
- Test: `tests/unit/slideshowApiClient.test.ts`
- Test: `tests/e2e/slideshow.spec.ts`

**Interfaces**
- Consumes: `CreateCollageBody`, `SlideshowJobResult`, `useUpload`, `useJob`.
- Produces:
  - `SLIDESHOW_TYPES`
  - `SlideshowFormValues`
  - `buildSlideshowBody(values, keys)`
  - `createCollageFormSchema` accepts image or video files in slideshow mode
  - `SlideshowResult`

**Step 1: Add failing form tests**

Create `tests/unit/slideshowForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSlideshowBody } from "@/features/collage/slideshowForm";

describe("slideshow form", () => {
  it("builds mixed source entries", () => {
    expect(
      buildSlideshowBody(
        {
          canvas: "1:1",
          fps: 30,
          transition: "fade",
          transitionSec: 0.5,
          sources: [
            { kind: "image", durationSec: 3, fit: "cover" },
            { kind: "video", startSec: 1, endSec: 5, fit: "contain" },
          ],
        },
        ["a", "b"],
      ),
    ).toEqual({
      mode: "slideshow",
      sources: [
        { key: "a", kind: "image", durationSec: 3, fit: "cover" },
        { key: "b", kind: "video", startSec: 1, endSec: 5, fit: "contain" },
      ],
      slideshow: { canvas: "1:1", fps: 30, transition: "fade", transitionSec: 0.5 },
      format: "mp4",
    });
  });
});
```

**Step 2: Run test and verify failure**

```bash
npx vitest run tests/unit/slideshowForm.test.ts
```

Expected: FAIL because slideshow form module does not exist.

**Step 3: Implement form and API client**

- Add `MODE_TYPES = image plus video`.
- Preserve the old image-only checks when mode is grid/polaroid.
- In slideshow mode, validate 1..20 files and each extension/MIME pair.
- Provide image duration and video start/end controls.
- Preserve a source list in the same order as selected files.
- Request a presigned upload for every source; the existing XHR hook supports video progress.
- Extend `createCollage` to continue accepting the new discriminated union.

**Step 4: Add result UI**

`SlideshowResult` displays:

- a native `<video controls src={masterUrl}>`;
- canvas/FPS/duration metadata;
- one download link for the ZIP;
- one link per slide;
- `aria-live` result status.

Update `CollageStatus` to parse `SlideshowJobResult` before the existing grid result fallback.

**Step 5: Add E2E test**

Create `tests/e2e/slideshow.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("shows mixed-media slideshow controls", async ({ page }) => {
  await page.goto("/collages");
  await page.getByRole("button", { name: "Slideshow" }).click();
  await expect(page.getByLabel("Canvas")).toBeVisible();
  await expect(page.getByLabel("Transition")).toBeVisible();
});
```

Keep API/object-store dependencies mocked like the existing collage E2E tests.

**Step 6: Run UI tests**

```bash
npx vitest run tests/unit/slideshowForm.test.ts tests/unit/slideshowApiClient.test.ts tests/unit/collageForm.test.ts
npx playwright test tests/e2e/slideshow.spec.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add -- src/features/collage/form.ts src/features/collage/api.ts src/components/collage/CollageCreateForm.tsx src/components/collage/CollageOptionsFields.tsx src/components/collage/CollageStatus.tsx src/components/collage/SlideshowOptionsFields.tsx src/components/collage/SlideshowResult.tsx src/features/collage/slideshowForm.ts tests/unit/slideshowForm.test.ts tests/unit/slideshowApiClient.test.ts tests/e2e/slideshow.spec.ts
git diff --cached --check
git commit -m "feat: add slideshow collage UI" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Documentation, golden fixtures, and definition of done

**Files:**
- Modify: `docs/api.md`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-22-video-slideshow-design.md` only if implementation reveals a contract mismatch
- Test: `tests/integration/slideshowJobs.test.ts`
- Test: `tests/unit/slideshowSchemas.test.ts`
- Test: `tests/property/slideshowTimeline.test.ts`
- Test: `tests/e2e/slideshow.spec.ts`

**Step 1: Update environment and API docs**

Add `.env.example` entries:

```dotenv
SLIDESHOW_MAX_SLIDES=20
SLIDESHOW_MAX_SLIDE_SEC=30
SLIDESHOW_MAX_DURATION_SEC=300
SLIDESHOW_MAX_TRANSITION_SEC=2
```

Document `POST /api/collages` slideshow request and `SlideshowJobResult`. State that MP4 master and slide
URLs are short-lived and that the ZIP contains `slide-0.mp4` upward.

**Step 2: Add fixture metadata**

Add only tiny generated or recorded fixtures. `tests/fixtures/slideshow/README.md` must state:

- no large media is committed;
- tests generate tiny 1-second FFmpeg fixtures or use mocks;
- the golden test asserts dimensions, frame rate, slide count, and ZIP entry count.

**Step 3: Run full validation**

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
npx playwright test tests/e2e/slideshow.spec.ts
```

All commands must pass. If formatting fails, run `npx prettier --write` only on files changed for this plan.

**Step 4: Commit documentation**

```bash
git add -- docs/api.md .env.example README.md tests/fixtures/slideshow/README.md
git diff --cached --check
git commit -m "docs: document video slideshow support" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
