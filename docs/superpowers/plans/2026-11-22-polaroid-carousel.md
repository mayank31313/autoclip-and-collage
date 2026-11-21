# Polaroid Carousel Collage Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `polaroid` collage mode that places polaroid-style prints on one seamless "torn sheet glued on a diary page" spread, slices it into 2-10 carousel slides, and returns per-slide preview URLs plus a ZIP.

**Architecture:** Analyze, then plan, then render. A pure planner (`src/lib/planner/collage/polaroid/`) turns image ids, captions, slide count and aspect into a versioned `PolaroidSpec`; a sharp renderer executes the spec and cuts slides; a new `collage.polaroid` job type on the existing `collage` queue runs it in the worker. The API (`mode: "polaroid"` request body), the job result and the create form are extended; the grid mode is unchanged.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod 4, sharp 0.35, BullMQ, `fflate` (new, ZIP), Vitest + fast-check, Playwright, react-hook-form.

**Spec:** `docs/superpowers/specs/2026-11-22-polaroid-carousel-design.md` (Task 1 amends it in four places; the plan is authoritative where they differ).

## Global Constraints

- Slide width is `1080` px; slide height is `1350` px for `4:5` and `1080` px for `1:1`. No canvas field in the polaroid request.
- Slides: integer `2..10`; default `clamp(ceil(images / 3), 2, 10)`. `images.length >= slides` and `images.length <= slides * 6`.
- Captions: optional, exactly one per image when sent, 0..60 characters, plain text. Caption text must be escaped before sharp renders it (sharp always parses Pango markup, so a bare `&` makes it throw `invalid markup in text`).
- Output: one ZIP plus per-slide URLs, all presigned on every read; asset ids and keys are never exposed.
- Zod schemas in `src/lib/schemas` are the source of truth; planner and schema code is isomorphic and pure (no `fs`, `process`, `sharp`, network).
- TypeScript `strict`, no `any`, no non-null `!`. Named exports, files under 250 lines, functions under 40 lines, `@/` alias for `src/`, `node:` prefixed imports, comments explain why.
- No magic numbers: shared limits live in `src/lib/planner/collage/polaroid/defaults.ts`; server limits in `src/server/config.ts`.
- Prettier: `printWidth: 100`, double quotes, trailing commas. Run `npx prettier --write` on every file you create or edit.
- No image assets in the repo; the only new asset is the OFL font `assets/fonts/Caveat-Regular.ttf` (+ licence). No `fluent-ffmpeg`, no new UI library.
- Milestone 2 scope. Do not add a browser editor, other backgrounds, or video output.

## Environment and commit rules (read first)

- PowerShell: if `node`/`npm`/`npx` are not found, run `$env:Path = "C:\Program Files\nodejs;" + $env:Path` first in that command.
- **The working tree already contains the user's uncommitted work.** These files are pre-modified and this plan edits several of them. **Never** use `git add .`, `-A`, `-u`, or add a pre-modified file. Stage only the paths a task lists under "Commit". Their edits stay uncommitted for the user to review.

  Pre-modified (edit them, never stage them): `.env.example`, `docs/api.md`, `src/app/api/collages/route.ts`, `src/app/collages/page.tsx`, `src/components/collage/CollageCreateForm.tsx`, `src/components/collage/CollageOptionsFields.tsx`, `src/components/collage/CollageStatus.tsx`, `src/features/collage/api.ts`, `src/features/collage/form.ts`, `src/lib/schemas/api.ts`, `src/lib/schemas/collage.ts`, `src/server/config.ts`, `tests/unit/schemas.test.ts`, `tests/unit/collageForm.test.ts`, `tests/integration/routes.test.ts`, `tests/e2e/collage.spec.ts`.

- Files edited by this plan that are **clean** in git (safe to commit): `worker/index.ts`, `worker/runJob.ts`, `worker/processors/buildCollage.ts`, `src/app/api/jobs/[id]/route.ts`, `src/server/jobs/collageResult.ts`, `tests/unit/config.test.ts`, `package.json`, `package-lock.json`, the spec file. Before staging one, confirm with `git status --short <path>` that it shows nothing before your edit.
- Commit messages: `git commit -m "<subject>" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"`.
- The code below was validated in a throwaway prototype (since deleted): a sweep of 10,000 slide/image/seed combinations found no invariant violations (worst overlap ratio 0.273 against the 0.4 limit), the renderer tests pass, and the worst case (10 slides, 20 images) renders in about 10 s using about 160 MB RSS. Copy the code exactly; if a number looks arbitrary, it was tuned by that sweep.

## File Structure

Create:

| File | Responsibility |
|---|---|
| `src/lib/utils/rng.ts` | `hashStrings`, `createRng`: seeded determinism |
| `src/lib/planner/collage/polaroid/defaults.ts` | shared limits and layout constants |
| `src/lib/planner/collage/polaroid/geometry.ts` | rotated bounds, overlap ratio |
| `src/lib/planner/collage/polaroid/slides.ts` | `defaultSlideCount`, `slideCountProblem` |
| `src/lib/planner/collage/polaroid/options.ts` | `resolvePolaroidOptions` (request defaults) |
| `src/lib/planner/collage/polaroid/validate.ts` | `validatePolaroidSpec` |
| `src/lib/planner/collage/polaroid/paper.ts` | `planPaper` (torn sheet outline, page rules/holes) |
| `src/lib/planner/collage/polaroid/plan.ts` | `planPolaroidCarousel` |
| `src/lib/schemas/polaroid.ts` | `PolaroidSpec`, worker input/result, `POLAROID_JOB_TYPE` |
| `src/server/renderers/polaroidPaper.ts` | diary page + torn sheet + grain background |
| `src/server/renderers/polaroidPrint.ts` | one polaroid sprite (photo, frame, caption, shadow, tape) |
| `src/server/renderers/polaroid.ts` | `renderPolaroidSlides` |
| `src/server/renderers/zip.ts` | `writeZip` |
| `assets/fonts/Caveat-Regular.ttf`, `assets/fonts/OFL.txt` | caption font (SIL OFL) |
| `worker/processors/sources.ts` | download/inspect helpers shared by both processors |
| `worker/processors/buildPolaroid.ts` | `collage.polaroid` processor |
| `src/server/jobs/polaroidResult.ts` | `resolvePolaroidResult` (signed public result) |
| `src/features/collage/polaroidForm.ts` | polaroid form values, checks, request builder |
| `src/components/collage/PolaroidOptionsFields.tsx` | mode switch + polaroid option sections |
| `src/components/collage/PolaroidResult.tsx` | carousel preview + downloads |
| `tests/unit/polaroidPlanner.test.ts`, `tests/property/polaroidLayouts.test.ts`, `tests/unit/polaroidSchemas.test.ts`, `tests/unit/polaroidRenderer.test.ts`, `tests/unit/polaroidZip.test.ts`, `tests/unit/buildPolaroid.test.ts`, `tests/integration/polaroidJobs.test.ts`, `tests/integration/polaroidCollages.test.ts`, `tests/unit/polaroidForm.test.ts`, `tests/e2e/polaroid.spec.ts` | tests |

Modify: `src/lib/schemas/api.ts`, `src/server/config.ts`, `.env.example`, `tests/unit/config.test.ts`, `src/app/api/collages/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/server/jobs/collageResult.ts`, `worker/index.ts`, `worker/runJob.ts`, `worker/processors/buildCollage.ts`, `src/features/collage/form.ts`, `src/components/collage/CollageOptionsFields.tsx`, `src/components/collage/CollageCreateForm.tsx`, `src/components/collage/CollageStatus.tsx`, `docs/api.md`, `package.json`.

---

### Task 1: Polaroid planner, schemas and spec amendments

**Files:**
- Create: `src/lib/utils/rng.ts`, `src/lib/planner/collage/polaroid/{defaults,geometry,slides,validate,paper,plan}.ts`, `src/lib/schemas/polaroid.ts`
- Test: `tests/unit/polaroidPlanner.test.ts`, `tests/property/polaroidLayouts.test.ts`
- Modify: `docs/superpowers/specs/2026-11-22-polaroid-carousel-design.md`

**Interfaces:**
- Produces (used by every later task):
  - `hashStrings(parts: readonly string[]): number`, `createRng(seed: number): () => number`
  - `defaults.ts`: `POLAROID_SLIDE_WIDTH_PX`, `POLAROID_SLIDE_HEIGHT_PX` (`{"4:5":1350,"1:1":1080}`), `POLAROID_MIN_SLIDES`, `POLAROID_MAX_SLIDES`, `POLAROID_MAX_IMAGES_PER_SLIDE`, `POLAROID_MAX_CAPTION_CHARS`, `POLAROID_MAX_ROTATION_DEG`, and the layout constants
  - `defaultSlideCount(imageCount: number): number`; `slideCountProblem(imageCount: number, slideCount: number): string | null`
  - `planPolaroidCarousel(input: { images: {assetId: string; caption: string}[]; slideCount: number; slideAspect: "4:5" | "1:1" }): PolaroidSpec`
  - `@/lib/schemas/polaroid`: `PolaroidAspect`, `PolaroidCaption`, `PolaroidOptions`, `PolaroidWorkerInput`, `PolaroidWorkerResult`, `PolaroidItem`, `PaperSpec`, `PolaroidSpec`, `POLAROID_JOB_TYPE = "collage.polaroid"` (+ inferred types)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/polaroidPlanner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { overlapRatio, rotatedBounds } from "@/lib/planner/collage/polaroid/geometry";
import { planPaper } from "@/lib/planner/collage/polaroid/paper";
import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";
import { defaultSlideCount, slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { validatePolaroidSpec } from "@/lib/planner/collage/polaroid/validate";
import { PolaroidSpec } from "@/lib/schemas/polaroid";
import { createRng, hashStrings } from "@/lib/utils/rng";

const images = (count: number, prefix = "a") =>
  Array.from({ length: count }, (_, i) => ({
    assetId: `${prefix}${i}`,
    caption: i % 2 === 1 ? `cap ${i}` : "",
  }));

describe("rng", () => {
  it("repeats a seed's sequence and stays in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const first = Array.from({ length: 50 }, () => a());
    expect(first).toEqual(Array.from({ length: 50 }, () => b()));
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(first[0]);
  });

  it("hashes the ordered ids", () => {
    expect(hashStrings(["a", "b"])).toBe(hashStrings(["a", "b"]));
    expect(hashStrings(["a", "b"])).not.toBe(hashStrings(["b", "a"]));
    expect(hashStrings(["a", "b"])).not.toBe(hashStrings(["ab"]));
  });
});

describe("geometry", () => {
  it("returns the frame itself when unrotated", () => {
    expect(rotatedBounds({ x: 10, y: 20, w: 100, h: 200, rotationDeg: 0 })).toEqual({
      x0: 10,
      y0: 20,
      x1: 110,
      y1: 220,
    });
  });

  it("swaps width and height at 90 degrees about the centre", () => {
    const b = rotatedBounds({ x: 0, y: 0, w: 100, h: 200, rotationDeg: 90 });
    expect([b.x0, b.y0, b.x1, b.y1].map(Math.round)).toEqual([-50, 50, 150, 150]);
  });

  it("measures overlap against the smaller box", () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(overlapRatio(a, { x0: 20, y0: 0, x1: 30, y1: 10 })).toBe(0);
    expect(overlapRatio(a, { x0: 0, y0: 0, x1: 5, y1: 5 })).toBe(1);
    expect(overlapRatio(a, { x0: 5, y0: 0, x1: 15, y1: 10 })).toBeCloseTo(0.5);
  });
});

describe("slide counts", () => {
  it("derives about three images per slide within 2..10", () => {
    expect([1, 6, 7, 20, 60].map(defaultSlideCount)).toEqual([2, 2, 3, 7, 10]);
  });

  it("explains combinations that cannot work", () => {
    expect(slideCountProblem(1, 2)).toBe("2 slides need at least 2 images");
    expect(slideCountProblem(13, 2)).toBe("2 slides hold at most 12 images");
    expect(slideCountProblem(2, 2)).toBeNull();
    expect(slideCountProblem(12, 2)).toBeNull();
  });
});

describe("planPaper", () => {
  const spread = { w: 3240, h: 1350 };

  it("is deterministic for a seed", () => {
    expect(planPaper(spread, 7, createRng(7))).toEqual(planPaper(spread, 7, createRng(7)));
    expect(planPaper(spread, 7, createRng(7))).not.toEqual(planPaper(spread, 8, createRng(8)));
  });

  it("keeps a torn sheet strictly inside the spread", () => {
    const { sheet } = planPaper(spread, 7, createRng(7));
    expect(sheet.outline.length).toBeGreaterThan(400);
    for (const [x, y] of sheet.outline) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(spread.w);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(spread.h);
    }
  });

  it("punches binding holes along the top margin", () => {
    const { page } = planPaper(spread, 7, createRng(7));
    expect(page.holes.xs).toHaveLength(Math.floor(spread.w / 90));
    expect(Math.max(...page.holes.xs)).toBeLessThan(spread.w);
  });
});

describe("planPolaroidCarousel", () => {
  it("sizes the spread from the slide count and aspect", () => {
    const portrait = planPolaroidCarousel({ images: images(4), slideCount: 2, slideAspect: "4:5" });
    expect(portrait.spread).toEqual({ w: 2160, h: 1350 });
    expect(portrait.slide).toEqual({ w: 1080, h: 1350, count: 2 });
    const square = planPolaroidCarousel({ images: images(4), slideCount: 3, slideAspect: "1:1" });
    expect(square.spread).toEqual({ w: 3240, h: 1080 });
  });

  it("places every image once, left to right, keeping captions", () => {
    const spec = planPolaroidCarousel({ images: images(5), slideCount: 2, slideAspect: "4:5" });
    expect(spec.polaroids.map((p) => p.image)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(spec.polaroids.map((p) => p.caption)).toEqual(["", "cap 1", "", "cap 3", ""]);
    const centres = spec.polaroids.map((p) => p.x + p.w / 2);
    expect(centres).toEqual([...centres].sort((a, b) => a - b));
  });

  it("is deterministic and depends on the image ids", () => {
    const input = { images: images(6), slideCount: 3, slideAspect: "4:5" } as const;
    expect(planPolaroidCarousel(input)).toEqual(planPolaroidCarousel(input));
    const other = planPolaroidCarousel({ ...input, images: images(6, "b") });
    const tilts = (spec: PolaroidSpec) => spec.polaroids.map((p) => p.rotationDeg);
    expect(tilts(other)).not.toEqual(tilts(planPolaroidCarousel(input)));
  });

  it("lets a polaroid straddle a slide seam", () => {
    const spec = planPolaroidCarousel({ images: images(6), slideCount: 2, slideAspect: "4:5" });
    expect(spec.polaroids.some((p) => p.x < 1080 && p.x + p.w > 1080)).toBe(true);
  });

  it("alternates sizes and upper and lower bands", () => {
    const spec = planPolaroidCarousel({ images: images(6), slideCount: 2, slideAspect: "4:5" });
    const [p0, p1, p2] = spec.polaroids;
    expect(p0 && p1 && p0.y + p0.h / 2 < p1.y + p1.h / 2).toBe(true);
    expect(p0 && p2 && p2.w < p0.w).toBe(true);
  });
});

describe("validatePolaroidSpec", () => {
  const spec = planPolaroidCarousel({ images: images(4), slideCount: 2, slideAspect: "4:5" });
  const messages = (candidate: unknown) =>
    validatePolaroidSpec(candidate as PolaroidSpec).map((issue) => issue.message);

  it("accepts a planned spec", () => {
    expect(messages(spec)).toEqual([]);
  });

  it("rejects a polaroid outside the spread", () => {
    const polaroids = spec.polaroids.map((p, i) => (i === 0 ? { ...p, x: -200 } : p));
    expect(messages({ ...spec, polaroids })).toContain("polaroid extends outside the spread");
  });

  it("rejects a reused image", () => {
    const polaroids = spec.polaroids.map((p, i) => (i === 1 ? { ...p, image: "a0" } : p));
    expect(messages({ ...spec, polaroids })).toContain("image is used more than once");
  });

  it("rejects an empty slide", () => {
    const polaroids = spec.polaroids.slice(0, 1);
    expect(messages({ ...spec, polaroids })).toContain("slide 2 has no polaroid");
  });

  it("rejects heavily stacked polaroids", () => {
    const [first, second] = spec.polaroids;
    if (!first || !second) throw new Error("fixture needs two polaroids");
    const polaroids = [first, { ...second, x: first.x, y: first.y }];
    expect(messages({ ...spec, polaroids }).join()).toContain("overlaps polaroid 0 too much");
  });

  it("rejects a spec whose slide sizes disagree with the spread", () => {
    expect(messages({ ...spec, slide: { ...spec.slide, count: 3 } })).toContain(
      "slide width times count must equal spread width",
    );
  });

  it("is enforced by the schema", () => {
    expect(PolaroidSpec.safeParse(spec).success).toBe(true);
    const polaroids = spec.polaroids.map((p, i) => (i === 0 ? { ...p, x: -200 } : p));
    expect(PolaroidSpec.safeParse({ ...spec, polaroids }).success).toBe(false);
  });
});
```

Create `tests/property/polaroidLayouts.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { POLAROID_MAX_ROTATION_DEG } from "@/lib/planner/collage/polaroid/defaults";
import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";

const MAX_IMAGES = 20;
const MAX_PER_SLIDE = 6;

const planInput = fc.integer({ min: 2, max: 10 }).chain((slideCount) =>
  fc
    .integer({ min: slideCount, max: Math.min(MAX_IMAGES, slideCount * MAX_PER_SLIDE) })
    .chain((count) =>
      fc.record({
        slideCount: fc.constant(slideCount),
        slideAspect: fc.constantFrom("4:5" as const, "1:1" as const),
        ids: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: count,
          maxLength: count,
        }),
      }),
    ),
);

const toInput = (p: { slideCount: number; slideAspect: "4:5" | "1:1"; ids: string[] }) => ({
  slideCount: p.slideCount,
  slideAspect: p.slideAspect,
  images: p.ids.map((assetId) => ({ assetId, caption: "" })),
});

describe("planPolaroidCarousel (property)", () => {
  it("yields a valid spec: inside the spread, bounded overlap, every slide used", () => {
    // Planning parses the spec, so a thrown error means an invariant (bounds, overlap, slides) broke.
    fc.assert(
      fc.property(planInput, (p) => {
        const spec = planPolaroidCarousel(toInput(p));
        expect(spec.polaroids).toHaveLength(p.ids.length);
        expect(spec.spread.w).toBe(spec.slide.w * p.slideCount);
      }),
      { numRuns: 60 },
    );
  });

  it("uses each image exactly once and keeps tilt within the limit", () => {
    fc.assert(
      fc.property(planInput, (p) => {
        const spec = planPolaroidCarousel(toInput(p));
        expect(spec.polaroids.map((x) => x.image)).toEqual(p.ids);
        for (const item of spec.polaroids) {
          expect(Math.abs(item.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_ROTATION_DEG);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(planInput, (p) => {
        expect(planPolaroidCarousel(toInput(p))).toEqual(planPolaroidCarousel(toInput(p)));
      }),
      { numRuns: 30 },
    );
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/polaroidPlanner.test.ts tests/property/polaroidLayouts.test.ts`
Expected: FAIL (cannot resolve `@/lib/planner/collage/polaroid/...`).

- [ ] **Step 3: Implement the modules**

Create `src/lib/utils/rng.ts`:

```ts
/** 32-bit FNV-1a hash of `parts` joined by a newline; stable across runtimes. */
export function hashStrings(parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const ch of parts.join("\n")) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Seeded generator returning floats in [0, 1) (mulberry32). Same seed gives the same sequence. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Create `src/lib/planner/collage/polaroid/defaults.ts`:

```ts
/** Shared limits and layout constants for polaroid carousels. All lengths are canvas px. */
export const POLAROID_SLIDE_WIDTH_PX = 1080;
export const POLAROID_SLIDE_HEIGHT_PX = { "4:5": 1350, "1:1": 1080 } as const;
export const POLAROID_MIN_SLIDES = 2;
export const POLAROID_MAX_SLIDES = 10;
export const POLAROID_IMAGES_PER_SLIDE_DEFAULT = 3;
export const POLAROID_MAX_IMAGES_PER_SLIDE = 6;
export const POLAROID_MAX_CAPTION_CHARS = 60;

/** Torn sheet is inset from the spread edge so the diary page shows around it. */
export const SHEET_INSET_PX = 80;
export const TEAR_AMPLITUDE_PX = 12;
export const TEAR_STEP_PX = 14;
/** Extra clearance between the sheet edge and the polaroids' rotated bounds. */
export const CONTENT_PAD_PX = 28;
export const CONTENT_MARGIN_PX = SHEET_INSET_PX + CONTENT_PAD_PX;

export const PAGE_RULE_STEP_PX = 44;
export const PAGE_HOLE_PITCH_PX = 90;
export const PAGE_HOLE_Y_PX = 40;
export const PAGE_HOLE_RADIUS_PX = 9;

/** Polaroid frame height as a multiple of its width (square photo plus thick bottom strip). */
export const POLAROID_FRAME_RATIO = 1.22;
export const POLAROID_MAX_WIDTH_PX = 432;
export const POLAROID_MIN_WIDTH_PX = 220;
export const POLAROID_SMALL_SCALE = 0.82;
export const POLAROID_MAX_ROTATION_DEG = 6;
export const POLAROID_ROW_FILL = 0.92;
export const POLAROID_JITTER_X_FRACTION = 0.1;
export const POLAROID_JITTER_Y_FRACTION = 0.04;
export const POLAROID_BAND_CENTERS = [0.27, 0.73] as const;
/** Largest allowed overlap of two rotated bounds, as a fraction of the smaller one's area. */
export const POLAROID_MAX_OVERLAP_RATIO = 0.4;
export const POLAROID_TAPE_VARIANTS = ["top", "left", "right"] as const;
```

Create `src/lib/planner/collage/polaroid/geometry.ts`:

```ts
export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned bounds, in px, of a frame rotated about its centre. */
export function rotatedBounds(frame: FrameRect): Bounds {
  const rad = (frame.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfW = (frame.w * cos + frame.h * sin) / 2;
  const halfH = (frame.w * sin + frame.h * cos) / 2;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH };
}

function area(b: Bounds): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

/** Overlap area divided by the smaller bound's area; 0 when disjoint. */
export function overlapRatio(a: Bounds, b: Bounds): number {
  const inter = area({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  });
  const smaller = Math.min(area(a), area(b));
  return smaller === 0 ? 0 : inter / smaller;
}
```

Create `src/lib/planner/collage/polaroid/slides.ts`:

```ts
import {
  POLAROID_IMAGES_PER_SLIDE_DEFAULT,
  POLAROID_MAX_IMAGES_PER_SLIDE,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
} from "./defaults";

/** Slide count used when the caller does not choose one; about three images per slide. */
export function defaultSlideCount(imageCount: number): number {
  const wanted = Math.ceil(imageCount / POLAROID_IMAGES_PER_SLIDE_DEFAULT);
  return Math.min(POLAROID_MAX_SLIDES, Math.max(POLAROID_MIN_SLIDES, wanted));
}

/** Returns why `imageCount` images cannot fill `slideCount` slides, or null when they can. */
export function slideCountProblem(imageCount: number, slideCount: number): string | null {
  if (imageCount < slideCount) {
    return `${slideCount} slides need at least ${slideCount} images`;
  }
  const capacity = slideCount * POLAROID_MAX_IMAGES_PER_SLIDE;
  if (imageCount > capacity) {
    return `${slideCount} slides hold at most ${capacity} images`;
  }
  return null;
}
```

Create `src/lib/planner/collage/polaroid/validate.ts`:

```ts
import { POLAROID_MAX_OVERLAP_RATIO } from "./defaults";
import { overlapRatio, rotatedBounds, type Bounds, type FrameRect } from "./geometry";

export interface PolaroidIssue {
  path: (string | number)[];
  message: string;
}

/** Structural view of a PolaroidSpec so the schema can call this without an import cycle. */
export interface PolaroidSpecLike {
  spread: { w: number; h: number };
  slide: { w: number; count: number };
  polaroids: ReadonlyArray<FrameRect & { image: string }>;
  paper: { sheet: { outline: ReadonlyArray<readonly [number, number]> } };
}

function checkPlacement(spec: PolaroidSpecLike, bounds: Bounds[]): PolaroidIssue[] {
  const { spread, polaroids } = spec;
  const issues: PolaroidIssue[] = [];
  const seen = new Set<string>();
  polaroids.forEach((p, i) => {
    const b = bounds[i];
    if (b && (b.x0 < 0 || b.y0 < 0 || b.x1 > spread.w || b.y1 > spread.h)) {
      issues.push({ path: ["polaroids", i], message: "polaroid extends outside the spread" });
    }
    if (seen.has(p.image)) {
      issues.push({ path: ["polaroids", i, "image"], message: "image is used more than once" });
    }
    seen.add(p.image);
  });
  return issues;
}

function checkSlides(spec: PolaroidSpecLike): PolaroidIssue[] {
  const { spread, slide, polaroids } = spec;
  const issues: PolaroidIssue[] = [];
  if (slide.w * slide.count !== spread.w) {
    issues.push({ path: ["slide"], message: "slide width times count must equal spread width" });
  }
  for (let s = 0; s < slide.count; s++) {
    const from = s * slide.w;
    const has = polaroids.some((p) => {
      const cx = p.x + p.w / 2;
      return cx >= from && cx < from + slide.w;
    });
    if (!has) issues.push({ path: ["polaroids"], message: `slide ${s + 1} has no polaroid` });
  }
  return issues;
}

function checkSheet(spec: PolaroidSpecLike): PolaroidIssue[] {
  const { spread, paper } = spec;
  const outside = paper.sheet.outline.findIndex(
    ([x, y]) => x < 0 || y < 0 || x > spread.w || y > spread.h,
  );
  if (outside < 0) return [];
  return [{ path: ["paper", "sheet", "outline", outside], message: "sheet point outside spread" }];
}

function checkOverlaps(bounds: Bounds[]): PolaroidIssue[] {
  const issues: PolaroidIssue[] = [];
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      if (overlapRatio(bounds[i], bounds[j]) > POLAROID_MAX_OVERLAP_RATIO) {
        issues.push({
          path: ["polaroids", j],
          message: `polaroid overlaps polaroid ${i} too much`,
        });
      }
    }
  }
  return issues;
}

/**
 * Checks that spread and slide sizes agree, polaroids (rotated) and the torn sheet lie inside the
 * spread, each image is used once, every slide holds a polaroid centre, and overlaps stay bounded.
 * All values are integer spread pixels. Pure and deterministic.
 */
export function validatePolaroidSpec(spec: PolaroidSpecLike): PolaroidIssue[] {
  const bounds = spec.polaroids.map((p) => rotatedBounds(p));
  return [
    ...checkPlacement(spec, bounds),
    ...checkSlides(spec),
    ...checkSheet(spec),
    ...checkOverlaps(bounds),
  ];
}
```

Create `src/lib/planner/collage/polaroid/paper.ts`:

```ts
import type { PaperSpec } from "@/lib/schemas/polaroid";
import {
  PAGE_HOLE_PITCH_PX,
  PAGE_HOLE_RADIUS_PX,
  PAGE_HOLE_Y_PX,
  PAGE_RULE_STEP_PX,
  SHEET_INSET_PX,
  TEAR_AMPLITUDE_PX,
  TEAR_STEP_PX,
} from "./defaults";

type Point = [number, number];

/** Smoothed random walk in [-amplitude, amplitude]: neighbouring points tear coherently. */
function tearOffsets(count: number, rng: () => number): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const step = (rng() * 2 - 1) * TEAR_AMPLITUDE_PX * 0.7;
    offset = Math.max(-TEAR_AMPLITUDE_PX, Math.min(TEAR_AMPLITUDE_PX, offset * 0.6 + step));
    out.push(Math.round(offset));
  }
  return out;
}

function edge(from: number, to: number, fixed: number, rng: () => number, horizontal: boolean) {
  const count = Math.max(2, Math.ceil(Math.abs(to - from) / TEAR_STEP_PX) + 1);
  const offsets = tearOffsets(count, rng);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const along = Math.round(from + ((to - from) * i) / (count - 1));
    const across = fixed + offsets[i];
    points.push(horizontal ? [along, across] : [across, along]);
  }
  return points;
}

/**
 * Plans the diary page (ruled lines, binding holes) and a torn sheet outline inset from the spread.
 * The outline is a closed polygon, clockwise from the top-left, in integer spread px.
 */
export function planPaper(spread: { w: number; h: number }, seed: number, rng: () => number) {
  const left = SHEET_INSET_PX;
  const top = SHEET_INSET_PX;
  const right = spread.w - SHEET_INSET_PX;
  const bottom = spread.h - SHEET_INSET_PX;
  const outline: Point[] = [
    ...edge(left, right, top, rng, true),
    ...edge(top, bottom, right, rng, false),
    ...edge(right, left, bottom, rng, true),
    ...edge(bottom, top, left, rng, false),
  ];
  const holeCount = Math.floor(spread.w / PAGE_HOLE_PITCH_PX);
  const xs = Array.from({ length: holeCount }, (_, i) =>
    Math.round(PAGE_HOLE_PITCH_PX * (i + 0.5)),
  );
  const paper: PaperSpec = {
    seed,
    page: {
      ruleStepPx: PAGE_RULE_STEP_PX,
      ruleFirstYPx: PAGE_RULE_STEP_PX,
      holes: { xs, yPx: PAGE_HOLE_Y_PX, rPx: PAGE_HOLE_RADIUS_PX },
    },
    sheet: { outline },
  };
  return paper;
}
```

Create `src/lib/planner/collage/polaroid/plan.ts`:

```ts
import { createRng, hashStrings } from "@/lib/utils/rng";
import { PolaroidSpec, type PolaroidAspect, type PolaroidItem } from "@/lib/schemas/polaroid";
import {
  CONTENT_MARGIN_PX,
  POLAROID_BAND_CENTERS,
  POLAROID_FRAME_RATIO,
  POLAROID_JITTER_X_FRACTION,
  POLAROID_JITTER_Y_FRACTION,
  POLAROID_MAX_ROTATION_DEG,
  POLAROID_MAX_WIDTH_PX,
  POLAROID_MIN_WIDTH_PX,
  POLAROID_ROW_FILL,
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_WIDTH_PX,
  POLAROID_SMALL_SCALE,
  POLAROID_TAPE_VARIANTS,
} from "./defaults";
import { rotatedBounds } from "./geometry";
import { planPaper } from "./paper";

export interface PolaroidPlanInput {
  images: ReadonlyArray<{ assetId: string; caption: string }>;
  slideCount: number;
  slideAspect: PolaroidAspect;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const jitter = (rng: () => number, amount: number) => (rng() * 2 - 1) * amount;

/** Half the rotated width, in px, of a frame of width `w` tilted by the maximum rotation. */
function halfRotatedWidth(w: number): number {
  const b = rotatedBounds({
    x: 0,
    y: 0,
    w,
    h: w * POLAROID_FRAME_RATIO,
    rotationDeg: POLAROID_MAX_ROTATION_DEG,
  });
  return (b.x1 - b.x0) / 2;
}

interface Lattice {
  spread: { w: number; h: number };
  usableH: number;
  baseW: number;
  first: number;
  pitch: number;
  jitterX: number;
}

/**
 * Centres sit on a lattice inset by the widest tilted frame, so no frame needs clamping. Horizontal
 * jitter is capped so consecutive centres are never more than one slide width apart, which
 * guarantees every slide holds a centre.
 */
function layoutLattice(count: number, slideCount: number, slideAspect: PolaroidAspect): Lattice {
  const spread = {
    w: POLAROID_SLIDE_WIDTH_PX * slideCount,
    h: POLAROID_SLIDE_HEIGHT_PX[slideAspect],
  };
  const usableW = spread.w - 2 * CONTENT_MARGIN_PX;
  const usableH = spread.h - 2 * CONTENT_MARGIN_PX;
  const maxW = Math.min(POLAROID_MAX_WIDTH_PX, Math.floor((usableH * 0.55) / POLAROID_FRAME_RATIO));
  const baseW = clamp((usableW / count) * 2 * POLAROID_ROW_FILL, POLAROID_MIN_WIDTH_PX, maxW);
  const inset = halfRotatedWidth(baseW);
  const pitch = (usableW - 2 * inset) / count;
  const jitterX = Math.min(
    pitch * POLAROID_JITTER_X_FRACTION,
    Math.max(0, (POLAROID_SLIDE_WIDTH_PX - pitch) / 2 - 1),
  );
  return { spread, usableH, baseW, first: CONTENT_MARGIN_PX + inset, pitch, jitterX };
}

function placeItem(
  image: { assetId: string; caption: string },
  i: number,
  lattice: Lattice,
  rng: () => number,
): PolaroidItem {
  const scale = Math.floor(i / 2) % 2 === 0 ? 1 : POLAROID_SMALL_SCALE;
  const w = Math.round(lattice.baseW * scale);
  const h = Math.round(w * POLAROID_FRAME_RATIO);
  const rotationDeg = Math.round(jitter(rng, POLAROID_MAX_ROTATION_DEG) * 10) / 10;
  const cx = lattice.first + lattice.pitch * (i + 0.5) + jitter(rng, lattice.jitterX);
  const band = POLAROID_BAND_CENTERS[i % 2];
  const bandY = CONTENT_MARGIN_PX + lattice.usableH * band;
  const cy = bandY + jitter(rng, lattice.usableH * POLAROID_JITTER_Y_FRACTION);
  return {
    id: i,
    image: image.assetId,
    caption: image.caption,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    w,
    h,
    rotationDeg,
    tape: POLAROID_TAPE_VARIANTS[i % POLAROID_TAPE_VARIANTS.length],
  };
}

/**
 * Plans a seamless diary spread: polaroids alternate between an upper and a lower band across the
 * whole spread (so they may straddle slide seams), with alternating sizes and seeded rotation.
 * Pure and deterministic; the seed derives from the ordered asset ids. Lengths are spread px.
 */
export function planPolaroidCarousel(input: PolaroidPlanInput): PolaroidSpec {
  const { images, slideCount, slideAspect } = input;
  const seed = hashStrings(images.map((i) => i.assetId));
  const rng = createRng(seed);
  const lattice = layoutLattice(images.length, slideCount, slideAspect);
  const polaroids = images.map((image, i) => placeItem(image, i, lattice, rng));
  return PolaroidSpec.parse({
    version: 1,
    spread: lattice.spread,
    slide: {
      w: POLAROID_SLIDE_WIDTH_PX,
      h: POLAROID_SLIDE_HEIGHT_PX[slideAspect],
      count: slideCount,
    },
    polaroids,
    paper: planPaper(lattice.spread, seed, rng),
  });
}
```

Create `src/lib/schemas/polaroid.ts`:

```ts
import { z } from "zod";
import { validatePolaroidSpec } from "@/lib/planner/collage/polaroid/validate";
import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_ROTATION_DEG,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
  POLAROID_TAPE_VARIANTS,
} from "@/lib/planner/collage/polaroid/defaults";
import { slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { CollageFormat, checkUnique } from "@/lib/schemas/collage";

export const POLAROID_JOB_TYPE = "collage.polaroid";

export const PolaroidAspect = z.enum(["4:5", "1:1"]);
export type PolaroidAspect = z.infer<typeof PolaroidAspect>;

export const PolaroidCaption = z.string().max(POLAROID_MAX_CAPTION_CHARS);
const SlideCount = z.number().int().min(POLAROID_MIN_SLIDES).max(POLAROID_MAX_SLIDES);

/** The `polaroid` options object of a create-collage request. */
export const PolaroidOptions = z.object({
  slides: SlideCount.optional(),
  slideAspect: PolaroidAspect,
  captions: z.array(PolaroidCaption).optional(),
});
export type PolaroidOptions = z.infer<typeof PolaroidOptions>;

/** Resolved worker input: slide count and captions are always explicit. */
export const PolaroidWorkerInput = z
  .object({
    sourceAssetIds: z.array(z.string().min(1)).min(1),
    slides: SlideCount,
    slideAspect: PolaroidAspect,
    captions: z.array(PolaroidCaption),
    format: CollageFormat,
  })
  .superRefine((input, ctx) => {
    checkUnique(ctx, input.sourceAssetIds, "sourceAssetIds", "asset ID");
    if (input.captions.length !== input.sourceAssetIds.length) {
      ctx.addIssue({ code: "custom", path: ["captions"], message: "one caption per image" });
    }
    const problem = slideCountProblem(input.sourceAssetIds.length, input.slides);
    if (problem) ctx.addIssue({ code: "custom", path: ["slides"], message: problem });
  });
export type PolaroidWorkerInput = z.infer<typeof PolaroidWorkerInput>;

/** Internal worker result; asset IDs are never exposed publicly. */
export const PolaroidWorkerResult = z.object({
  zipAssetId: z.string().min(1),
  slideAssetIds: z.array(z.string().min(1)).min(POLAROID_MIN_SLIDES),
  slideWidth: z.number().int().positive(),
  slideHeight: z.number().int().positive(),
  format: CollageFormat,
});
export type PolaroidWorkerResult = z.infer<typeof PolaroidWorkerResult>;

const Point = z.tuple([z.number().int(), z.number().int()]);

export const PolaroidItem = z.object({
  id: z.number().int().nonnegative(),
  image: z.string().min(1), // asset id
  caption: PolaroidCaption,
  x: z.number().int(), // unrotated frame top-left, spread px
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  rotationDeg: z.number().min(-POLAROID_MAX_ROTATION_DEG).max(POLAROID_MAX_ROTATION_DEG),
  tape: z.enum(POLAROID_TAPE_VARIANTS),
});
export type PolaroidItem = z.infer<typeof PolaroidItem>;

export const PaperSpec = z.object({
  seed: z.number().int().nonnegative(),
  page: z.object({
    ruleStepPx: z.number().int().positive(),
    ruleFirstYPx: z.number().int().nonnegative(),
    holes: z.object({
      xs: z.array(z.number().int()),
      yPx: z.number().int(),
      rPx: z.number().int().positive(),
    }),
  }),
  /** Closed polygon of the torn, glued sheet in spread px. */
  sheet: z.object({ outline: z.array(Point).min(3) }),
});
export type PaperSpec = z.infer<typeof PaperSpec>;

export const PolaroidSpec = z
  .object({
    version: z.literal(1),
    spread: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    slide: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      count: SlideCount,
    }),
    polaroids: z.array(PolaroidItem).min(1),
    paper: PaperSpec,
  })
  .superRefine((spec, ctx) => {
    for (const issue of validatePolaroidSpec(spec)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  });
export type PolaroidSpec = z.infer<typeof PolaroidSpec>;
```

- [ ] **Step 4: Amend the spec**

In `docs/superpowers/specs/2026-11-22-polaroid-carousel-design.md` make these replacements (use the edit tool):

1. `- \`images.length >= slides\` (every slide gets at least one polaroid).` becomes `- \`images.length >= slides\` (every slide gets at least one polaroid) and \`images.length <= slides * 6\`.`
2. `1. Diary page: cream paper, ruled lines, faint margin line, binding stitches.` becomes `1. Diary page: cream paper, ruled lines and binding holes along the top margin.`
3. `2. Torn sheet: rough-edged polygon with a lighter fibrous rim and soft shadow, glued over the page.` becomes `2. Torn sheet: rough-edged polygon with a lighter fibrous rim and a blurred shadow, glued over the page. Paper grain is a seeded, tiled noise layer; SVG filters are too slow at spread size.`
4. `New config caps: max slides, max caption length, max spread pixels (re-checked in the worker).` becomes `Slide count (2-10), caption length (60) and images per slide (6) are shared constants in \`polaroid/defaults.ts\`; config adds \`COLLAGE_POLAROID_MAX_SPREAD_PIXELS\` (re-checked in the worker) and \`POLAROID_FONT_PATH\`.`

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/polaroidPlanner.test.ts tests/property/polaroidLayouts.test.ts`
Expected: PASS (25 tests in 2 files).

- [ ] **Step 6: Format, typecheck, lint**

Run: `npx prettier --write src/lib/utils/rng.ts src/lib/planner/collage/polaroid src/lib/schemas/polaroid.ts tests/unit/polaroidPlanner.test.ts tests/property/polaroidLayouts.test.ts docs/superpowers/specs/2026-11-22-polaroid-carousel-design.md`
Run: `npx tsc --noEmit` (expected: no errors from these files; ignore none).
Run: `npx eslint src/lib/utils/rng.ts src/lib/planner/collage/polaroid src/lib/schemas/polaroid.ts tests/unit/polaroidPlanner.test.ts tests/property/polaroidLayouts.test.ts` (expected: clean).

- [ ] **Step 7: Commit**

```powershell
git add src/lib/utils/rng.ts src/lib/planner/collage/polaroid src/lib/schemas/polaroid.ts tests/unit/polaroidPlanner.test.ts tests/property/polaroidLayouts.test.ts docs/superpowers/specs/2026-11-22-polaroid-carousel-design.md
git commit -m "feat: plan polaroid carousel layouts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: API contract and config

**Files:**
- Create: `src/lib/planner/collage/polaroid/options.ts`, `tests/unit/polaroidSchemas.test.ts`
- Modify (pre-modified, do not stage): `src/lib/schemas/api.ts`, `src/server/config.ts`, `.env.example`
- Modify (clean, commit): `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: `PolaroidOptions`, `PolaroidAspect`, `defaultSlideCount`, `slideCountProblem` from Task 1.
- Produces:
  - `resolvePolaroidOptions(options: { slides?: number; slideAspect: PolaroidAspect; captions?: readonly string[] }, imageCount: number): { slides: number; slideAspect: PolaroidAspect; captions: string[] }`
  - `@/lib/schemas/api`: `CreateGridCollageBody`, `CreatePolaroidCollageBody`, `CreateCollageBody` (discriminated union on `mode`), `PolaroidJobResult`, plus their types
  - Config fields `polaroidMaxSpreadPixels: number`, `polaroidFontPath: string`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/polaroidSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolvePolaroidOptions } from "@/lib/planner/collage/polaroid/options";
import { CreateCollageBody, PolaroidJobResult } from "@/lib/schemas/api";
import { PolaroidWorkerInput, PolaroidWorkerResult } from "@/lib/schemas/polaroid";

const keys = (count: number) =>
  Array.from({ length: count }, (_, i) => `uploads/owner/u1/${i}.png`);
const polaroidBody = (
  count: number,
  polaroid: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  images: keys(count),
  mode: "polaroid",
  polaroid: { slideAspect: "4:5", ...polaroid },
  ...extra,
});
const parses = (value: unknown) => CreateCollageBody.safeParse(value).success;

describe("CreateCollageBody (polaroid)", () => {
  it("accepts a minimal body and defaults the format", () => {
    expect(CreateCollageBody.parse(polaroidBody(4))).toMatchObject({
      mode: "polaroid",
      format: "png",
      polaroid: { slideAspect: "4:5" },
    });
  });

  it("keeps routing grid bodies and rejects unknown modes", () => {
    const grid = { images: keys(1), mode: "grid", style: "justified", canvas: { w: 100, h: 100 } };
    expect(parses(grid)).toBe(true);
    expect(parses({ ...polaroidBody(4), mode: "sequence" })).toBe(false);
    expect(parses({ images: keys(4), mode: "polaroid" })).toBe(false);
  });

  it("limits slides to 2..10", () => {
    expect(parses(polaroidBody(6, { slides: 1 }))).toBe(false);
    expect(parses(polaroidBody(20, { slides: 11 }))).toBe(false);
    expect(parses(polaroidBody(20, { slides: 10 }))).toBe(true);
  });

  it("needs at least one image per slide, defaulting to about three per slide", () => {
    expect(parses(polaroidBody(1))).toBe(false);
    expect(parses(polaroidBody(2))).toBe(true);
    expect(parses(polaroidBody(2, { slides: 3 }))).toBe(false);
  });

  it("holds at most six images per slide", () => {
    expect(parses(polaroidBody(12, { slides: 2 }))).toBe(true);
    expect(parses(polaroidBody(13, { slides: 2 }))).toBe(false);
  });

  it("takes one caption of at most 60 characters per image", () => {
    const captions = (n: number, len = 5) => Array.from({ length: n }, () => "x".repeat(len));
    expect(parses(polaroidBody(4, { captions: captions(4) }))).toBe(true);
    expect(parses(polaroidBody(4, { captions: captions(3) }))).toBe(false);
    expect(parses(polaroidBody(4, { captions: captions(4, 60) }))).toBe(true);
    expect(parses(polaroidBody(4, { captions: captions(4, 61) }))).toBe(false);
  });

  it("rejects duplicate keys, HEIC, an unknown aspect and a non-http webhook", () => {
    const [first] = keys(1);
    expect(parses({ ...polaroidBody(2), images: [first, first] })).toBe(false);
    expect(parses({ ...polaroidBody(2), images: ["uploads/o/u/a.heic", "uploads/o/u/b.png"] })).toBe(
      false,
    );
    expect(parses(polaroidBody(4, { slideAspect: "16:9" }))).toBe(false);
    expect(parses(polaroidBody(4, {}, { webhookUrl: "ftp://example.com/x" }))).toBe(false);
    expect(parses(polaroidBody(4, {}, { webhookUrl: "https://example.com/x" }))).toBe(true);
  });
});

describe("resolvePolaroidOptions", () => {
  it("fills the slide count and blank captions", () => {
    expect(resolvePolaroidOptions({ slideAspect: "1:1" }, 7)).toEqual({
      slides: 3,
      slideAspect: "1:1",
      captions: Array.from({ length: 7 }, () => ""),
    });
  });

  it("keeps explicit slides and trims captions", () => {
    expect(
      resolvePolaroidOptions({ slides: 2, slideAspect: "4:5", captions: [" Hi ", ""] }, 2),
    ).toEqual({ slides: 2, slideAspect: "4:5", captions: ["Hi", ""] });
  });
});

describe("PolaroidWorkerInput", () => {
  const input = {
    sourceAssetIds: ["a", "b", "c"],
    slides: 2,
    slideAspect: "4:5",
    captions: ["", "", ""],
    format: "png",
  };

  it("accepts resolved input", () => {
    expect(PolaroidWorkerInput.safeParse(input).success).toBe(true);
  });

  it("rejects mismatched captions, duplicate ids and impossible slide counts", () => {
    expect(PolaroidWorkerInput.safeParse({ ...input, captions: ["", ""] }).success).toBe(false);
    expect(PolaroidWorkerInput.safeParse({ ...input, sourceAssetIds: ["a", "a", "c"] }).success).toBe(
      false,
    );
    expect(PolaroidWorkerInput.safeParse({ ...input, slides: 4 }).success).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => `id${i}`);
    const crowded = { ...input, sourceAssetIds: many, captions: many.map(() => "") };
    expect(PolaroidWorkerInput.safeParse(crowded).success).toBe(false);
  });
});

describe("polaroid results", () => {
  it("parses the internal result and needs at least two slides", () => {
    const result = {
      zipAssetId: "z",
      slideAssetIds: ["s1", "s2"],
      slideWidth: 1080,
      slideHeight: 1350,
      format: "png",
    };
    expect(PolaroidWorkerResult.safeParse(result).success).toBe(true);
    expect(PolaroidWorkerResult.safeParse({ ...result, slideAssetIds: ["s1"] }).success).toBe(false);
  });

  it("parses the public result and requires http(s) URLs", () => {
    const output = {
      slideCount: 2,
      slideWidth: 1080,
      slideHeight: 1350,
      slideFormat: "png",
      zipUrl: "https://minio.example/z.zip",
      slides: [
        { index: 0, url: "https://minio.example/1.png" },
        { index: 1, url: "https://minio.example/2.png" },
      ],
      expiresInSec: 900,
    };
    expect(PolaroidJobResult.safeParse({ output }).success).toBe(true);
    expect(PolaroidJobResult.safeParse({ output: { ...output, zipUrl: "javascript:x" } }).success).toBe(
      false,
    );
  });
});
```

Add to `tests/unit/config.test.ts` inside `describe("loadConfig", ...)`, after the "loads bounded collage defaults" test:

```ts
  it("loads polaroid defaults and overrides", () => {
    expect(loadConfig(valid)).toMatchObject({
      polaroidMaxSpreadPixels: 20_000_000,
      polaroidFontPath: "assets/fonts/Caveat-Regular.ttf",
    });
    expect(loadConfig({ ...valid, COLLAGE_POLAROID_MAX_SPREAD_PIXELS: "5000000" })).toMatchObject({
      polaroidMaxSpreadPixels: 5_000_000,
    });
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/polaroidSchemas.test.ts tests/unit/config.test.ts`
Expected: FAIL (missing `options` module, `PolaroidJobResult`, config fields).

- [ ] **Step 3: Implement `options.ts`**

Create `src/lib/planner/collage/polaroid/options.ts`:

```ts
import type { PolaroidAspect } from "@/lib/schemas/polaroid";
import { defaultSlideCount } from "./slides";

export interface ResolvedPolaroidOptions {
  slides: number;
  slideAspect: PolaroidAspect;
  captions: string[];
}

/** Fills request defaults: slide count from the image count and one trimmed caption per image. */
export function resolvePolaroidOptions(
  options: {
    slides?: number | undefined;
    slideAspect: PolaroidAspect;
    captions?: readonly string[] | undefined;
  },
  imageCount: number,
): ResolvedPolaroidOptions {
  return {
    slides: options.slides ?? defaultSlideCount(imageCount),
    slideAspect: options.slideAspect,
    captions: Array.from({ length: imageCount }, (_, i) => (options.captions?.[i] ?? "").trim()),
  };
}
```

- [ ] **Step 4: Edit `src/lib/schemas/api.ts`**

1. Add two imports after `import { CollageTemplateDefinition, TemplateId } from "@/lib/schemas/collageTemplate";`:

```ts
import { defaultSlideCount, slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { PolaroidOptions } from "@/lib/schemas/polaroid";
```

2. Directly after `const MAX_OBJECT_KEY_LENGTH = 1024;` add:

```ts
const ImageKey = z
  .string()
  .min(1)
  .max(MAX_OBJECT_KEY_LENGTH)
  .refine((key) => !HEIC_EXTENSION.test(key), NOT_HEIC);
```

3. Rename the existing `export const CreateCollageBody = z` to `export const CreateGridCollageBody = z`, and replace its inline `images:` field (the `z.array(z.string().min(1).max(MAX_OBJECT_KEY_LENGTH).refine(...)).min(1)` block) with:

```ts
    images: z.array(ImageKey).min(1),
```

4. Replace the line `export type CreateCollageBody = z.infer<typeof CreateCollageBody>;` with:

```ts
export type CreateGridCollageBody = z.infer<typeof CreateGridCollageBody>;

export const CreatePolaroidCollageBody = z
  .object({
    images: z.array(ImageKey).min(1),
    mode: z.literal("polaroid"),
    polaroid: PolaroidOptions,
    format: CollageFormat.default("png"),
    webhookUrl: HttpUrl.optional(),
  })
  .superRefine((body, ctx) => {
    checkUnique(ctx, body.images, "images", "image key");
    const { slides, captions } = body.polaroid;
    if (captions !== undefined && captions.length !== body.images.length) {
      ctx.addIssue({
        code: "custom",
        path: ["polaroid", "captions"],
        message: "send exactly one caption per image",
      });
    }
    const problem = slideCountProblem(
      body.images.length,
      slides ?? defaultSlideCount(body.images.length),
    );
    if (problem) ctx.addIssue({ code: "custom", path: ["polaroid", "slides"], message: problem });
  });
export type CreatePolaroidCollageBody = z.infer<typeof CreatePolaroidCollageBody>;

export const CreateCollageBody = z.discriminatedUnion("mode", [
  CreateGridCollageBody,
  CreatePolaroidCollageBody,
]);
export type CreateCollageBody = z.infer<typeof CreateCollageBody>;
```

5. Append at the end of the file:

```ts
export const PolaroidJobResult = z.object({
  output: z.object({
    slideCount: z.number().int().min(2),
    slideWidth: z.number().int().positive(),
    slideHeight: z.number().int().positive(),
    slideFormat: CollageFormat,
    zipUrl: HttpUrl,
    slides: z
      .array(z.object({ index: z.number().int().nonnegative(), url: HttpUrl }))
      .min(2),
    expiresInSec: z.number().int().positive(),
  }),
});
export type PolaroidJobResult = z.infer<typeof PolaroidJobResult>;
```

- [ ] **Step 5: Edit config and `.env.example`**

In `src/server/config.ts`, add to `EnvSchema` after `COLLAGE_TEMPLATES_DIR`:

```ts
  COLLAGE_POLAROID_MAX_SPREAD_PIXELS: z.coerce.number().int().positive().default(20_000_000),
  POLAROID_FONT_PATH: z.string().min(1).default("assets/fonts/Caveat-Regular.ttf"),
```

and to the returned object after `collageTemplatesDir`:

```ts
    polaroidMaxSpreadPixels: e.COLLAGE_POLAROID_MAX_SPREAD_PIXELS,
    polaroidFontPath: e.POLAROID_FONT_PATH,
```

Append to `.env.example` (before `STUDIO_API_KEY`'s comment block is fine; keep it near the collage settings):

```
# Largest polaroid carousel spread (slides x slide width x slide height), in pixels.
COLLAGE_POLAROID_MAX_SPREAD_PIXELS=20000000
# Caption font for polaroid carousels (relative to the working directory). The worker image must
# include this file.
POLAROID_FONT_PATH=assets/fonts/Caveat-Regular.ttf
```

- [ ] **Step 6: Run and confirm pass**

Run: `npx vitest run tests/unit/polaroidSchemas.test.ts tests/unit/config.test.ts tests/unit/schemas.test.ts`
Expected: PASS (existing grid schema tests still pass through the union).
Run: `npx tsc --noEmit`. Expected: errors only at grid-only call sites of the now-union `CreateCollageBody` (`src/app/api/collages/route.ts`, which Task 5 fixes). Anything else must be fixed now.

- [ ] **Step 7: Format and commit**

Run: `npx prettier --write src/lib/planner/collage/polaroid/options.ts src/lib/schemas/api.ts src/server/config.ts tests/unit/polaroidSchemas.test.ts tests/unit/config.test.ts`

```powershell
git add src/lib/planner/collage/polaroid/options.ts tests/unit/polaroidSchemas.test.ts tests/unit/config.test.ts
git commit -m "feat: add polaroid collage request options" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

(`api.ts`, `config.ts` and `.env.example` stay uncommitted by design.)

---

### Task 3: Renderer, font and ZIP

**Files:**
- Create: `assets/fonts/Caveat-Regular.ttf`, `assets/fonts/OFL.txt`, `src/server/renderers/polaroidPaper.ts`, `src/server/renderers/polaroidPrint.ts`, `src/server/renderers/polaroid.ts`, `src/server/renderers/zip.ts`
- Test: `tests/unit/polaroidRenderer.test.ts`, `tests/unit/polaroidZip.test.ts`
- Modify (clean, commit): `package.json`, `package-lock.json` (adds `fflate`)

**Interfaces:**
- Consumes: `PolaroidSpec`, `PolaroidItem` (Task 1); `AppError` from `@/server/http/errors`; `CollageFormat` from `@/lib/schemas/collage`.
- Produces:
  - `renderPolaroidSlides(args: RenderPolaroidArgs): Promise<string[]>` where `RenderPolaroidArgs = { spec: PolaroidSpec; sourcePaths: ReadonlyMap<string, string>; fontPath: string; outputDir: string; format: CollageFormat }`; returns slide file paths in order, named `slide-01.png` (or `.jpg`), `slide-02...`
  - `escapeMarkup(text: string): string` (from `polaroidPrint.ts`)
  - `writeZip(files: readonly string[], outPath: string): Promise<void>`

- [ ] **Step 1: Add the dependency and the font**

Run: `git status --short package.json package-lock.json` (expected: no output; if there is output, stop and ask the user).
Run: `npm install fflate`
Run:

```powershell
New-Item -ItemType Directory -Force assets\fonts | Out-Null
curl.exe -sL -o assets\fonts\Caveat-Regular.ttf https://github.com/googlefonts/caveat/raw/main/fonts/ttf/Caveat-Regular.ttf
curl.exe -sL -o assets\fonts\OFL.txt https://github.com/googlefonts/caveat/raw/main/OFL.txt
(Get-Item assets\fonts\Caveat-Regular.ttf).Length
[BitConverter]::ToString([IO.File]::ReadAllBytes("assets\fonts\Caveat-Regular.ttf")[0..3])
Select-String -Path assets\fonts\OFL.txt -Pattern "Copyright" | Select-Object -First 1
```

Expected: size about `297900`, header bytes `00-01-00-00` (TrueType), and a `Copyright 2014 The Caveat Project Authors` line. If the download is an HTML page instead, stop and report.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/polaroidZip.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeZip } from "@/server/renderers/zip";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polaroid-zip-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeZip", () => {
  it("stores each file under its base name, in order", async () => {
    const one = path.join(dir, "slide-01.png");
    const two = path.join(dir, "slide-02.png");
    await writeFile(one, "first");
    await writeFile(two, "second");
    const out = path.join(dir, "out.zip");
    await writeZip([one, two], out);
    const entries = unzipSync(new Uint8Array(await readFile(out)));
    expect(Object.keys(entries)).toEqual(["slide-01.png", "slide-02.png"]);
    expect(Buffer.from(entries["slide-02.png"] ?? new Uint8Array()).toString()).toBe("second");
  });

  it("rejects when a file is missing", async () => {
    await expect(
      writeZip([path.join(dir, "missing.png")], path.join(dir, "never.zip")),
    ).rejects.toThrow();
  });
});
```

Create `tests/unit/polaroidRenderer.test.ts`:

```ts
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
  const { data, info } = await sharp(file)
    .extract({
      left: Math.round(cx - slideOf(item) * SLIDE_W) - 120,
      top: Math.round(cy) + 165,
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
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/unit/polaroidZip.test.ts tests/unit/polaroidRenderer.test.ts`
Expected: FAIL (cannot resolve `@/server/renderers/...`).

- [ ] **Step 4: Implement the renderer modules**

Create `src/server/renderers/zip.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

/**
 * Writes `files` into one ZIP under their base names. Images are already compressed, so entries
 * are stored (level 0); slides are bounded by the carousel limits, so reading them whole is safe.
 */
export async function writeZip(files: readonly string[], outPath: string): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[path.basename(file)] = new Uint8Array(await readFile(file));
  await writeFile(outPath, zipSync(entries, { level: 0 }));
}
```

Create `src/server/renderers/polaroidPaper.ts`:

```ts
import sharp, { type Raw } from "sharp";
import type { PolaroidSpec } from "@/lib/schemas/polaroid";
import { createRng } from "@/lib/utils/rng";

const PAGE_COLOR = "#efe2c4";
const RULE_COLOR = "#9fb7cf";
const HOLE_FILL = "#d8c8a0";
const HOLE_RING = "#a8946a";
const SHEET_COLOR = "#fbf7ea";
const SHEET_RIM_WIDTH_PX = 7;
const SHADOW_OFFSET_PX = { x: 8, y: 12 };
const SHADOW_BLUR_SIGMA = 9;
const SHADOW_OPACITY = 0.38;
const GRAIN_TILE_PX = 256;
/** Maximum alpha of a grain speck; fibres stay subtle so photos remain the focus. */
const GRAIN_MAX_ALPHA = 40;
const GRAIN_RGB = [115, 92, 61] as const;

const svgOpen = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;

function outlinePoints(spec: PolaroidSpec): string {
  return spec.paper.sheet.outline.map(([x, y]) => `${x},${y}`).join(" ");
}

/** Diary page: cream paper, faint ruled lines and binding holes along the top margin. */
export function pageSvg(spec: PolaroidSpec): string {
  const { w, h } = spec.spread;
  const { page } = spec.paper;
  const rules: string[] = [];
  for (let y = page.ruleFirstYPx; y < h; y += page.ruleStepPx) {
    rules.push(`<line x1="0" x2="${w}" y1="${y}" y2="${y}"/>`);
  }
  const holes = page.holes.xs
    .map((x) => `<circle cx="${x}" cy="${page.holes.yPx}" r="${page.holes.rPx}"/>`)
    .join("");
  return (
    `${svgOpen(w, h)}<rect width="${w}" height="${h}" fill="${PAGE_COLOR}"/>` +
    `<g stroke="${RULE_COLOR}" stroke-opacity="0.55" stroke-width="2">${rules.join("")}</g>` +
    `<g fill="${HOLE_FILL}" stroke="${HOLE_RING}" stroke-width="2">${holes}</g></svg>`
  );
}

/** Torn sheet with a lighter rim (exposed paper fibres) on a transparent background. */
export function sheetSvg(spec: PolaroidSpec): string {
  const { w, h } = spec.spread;
  const points = outlinePoints(spec);
  return (
    `${svgOpen(w, h)}<polygon points="${points}" fill="${SHEET_COLOR}" stroke="#fffdf5" ` +
    `stroke-width="${SHEET_RIM_WIDTH_PX}" stroke-linejoin="round" paint-order="stroke"/></svg>`
  );
}

function shadowSvg(spec: PolaroidSpec): string {
  const { w, h } = spec.spread;
  return (
    `${svgOpen(w, h)}<polygon points="${outlinePoints(spec)}" fill="#000" ` +
    `fill-opacity="${SHADOW_OPACITY}" transform="translate(${SHADOW_OFFSET_PX.x} ${SHADOW_OFFSET_PX.y})"/></svg>`
  );
}

/** Seeded white-noise tile; tiles seamlessly because every pixel is independent. */
function grainTile(seed: number): { data: Buffer; raw: Raw } {
  const rng = createRng(seed);
  const data = Buffer.alloc(GRAIN_TILE_PX * GRAIN_TILE_PX * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = GRAIN_RGB[0];
    data[i + 1] = GRAIN_RGB[1];
    data[i + 2] = GRAIN_RGB[2];
    data[i + 3] = Math.floor(rng() * GRAIN_MAX_ALPHA);
  }
  return { data, raw: { width: GRAIN_TILE_PX, height: GRAIN_TILE_PX, channels: 4 } };
}

/**
 * Renders the paper background (page, soft shadow, glued torn sheet, grain) as an opaque PNG of
 * exactly the spread size. Uses sharp layers instead of SVG filters, which are too slow at spread size.
 */
export async function renderPaper(spec: PolaroidSpec): Promise<Buffer> {
  const shadow = await sharp(Buffer.from(shadowSvg(spec)))
    .blur(SHADOW_BLUR_SIGMA)
    .png()
    .toBuffer();
  const sheet = await sharp(Buffer.from(sheetSvg(spec))).png().toBuffer();
  const grain = grainTile(spec.paper.seed);
  const tile = await sharp(grain.data, { raw: grain.raw }).png().toBuffer();
  return sharp(Buffer.from(pageSvg(spec)))
    .composite([{ input: shadow }, { input: sheet }, { input: tile, tile: true }])
    .png()
    .toBuffer();
}
```

Create `src/server/renderers/polaroidPrint.ts`:

```ts
import sharp, { type OverlayOptions } from "sharp";
import type { PolaroidItem } from "@/lib/schemas/polaroid";

const FRAME_COLOR = "#fbfaf4";
const CAPTION_COLOR = "#2f3a52";
const CAPTION_FONT = "Caveat";
const SIDE_FRACTION = 0.065;
/** Transparent padding around the card so its shadow and tape fit before rotation. */
export const SPRITE_PAD_PX = 60;
const SHADOW = { dx: 3, dy: 8, blur: 9, opacity: 0.38 };
const CAPTION_HEIGHT_FRACTION = 0.7;
const TAPE = { w: 150, h: 70, color: "#f0e4a6", opacity: 0.72 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export interface PrintSprite {
  input: Buffer;
  left: number;
  top: number;
}

/** Pango markup treats & < > as syntax, so caption text must be escaped before rendering. */
export function escapeMarkup(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tapeSvg(angleDeg: number): Buffer {
  const { w, h, color, opacity } = TAPE;
  const x0 = 15;
  const x1 = w - 15;
  const y0 = 17;
  const y1 = h - 17;
  const zig = (x: number, dir: 1 | -1) =>
    [0, 1, 2, 3].map(
      (i) => `${x + (i % 2 === 0 ? 0 : 4 * dir)},${y0 + (i + 0.5) * ((y1 - y0) / 4)}`,
    );
  const points = [
    `${x0},${y0}`,
    `${x1},${y0}`,
    ...zig(x1, -1),
    `${x1},${y1}`,
    `${x0},${y1}`,
    ...zig(x0, 1).reverse(),
  ];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<g transform="rotate(${angleDeg} ${w / 2} ${h / 2})">` +
      `<polygon points="${points.join(" ")}" fill="${color}" fill-opacity="${opacity}"/></g></svg>`,
  );
}

function tapePlacement(item: PolaroidItem) {
  const pad = SPRITE_PAD_PX;
  if (item.tape === "left") return { cx: pad + item.w * 0.1, cy: pad + 6, angle: -38 };
  if (item.tape === "right") return { cx: pad + item.w * 0.9, cy: pad + 6, angle: 38 };
  return { cx: pad + item.w / 2, cy: pad + 4, angle: -3 };
}

async function renderCard(item: PolaroidItem, sourcePath: string, fontPath: string) {
  const side = Math.round(item.w * SIDE_FRACTION);
  const photoSize = item.w - 2 * side;
  const stripH = item.h - side - photoSize;
  const photo = await sharp(sourcePath)
    .rotate()
    .resize({ width: photoSize, height: photoSize, fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const layers: OverlayOptions[] = [{ input: photo, left: side, top: side }];
  if (item.caption.trim() !== "") {
    const { data, info } = await sharp({
      text: {
        text: `<span foreground="${CAPTION_COLOR}">${escapeMarkup(item.caption)}</span>`,
        font: CAPTION_FONT,
        fontfile: fontPath,
        rgba: true,
        align: "center",
        width: photoSize,
        height: Math.round(stripH * CAPTION_HEIGHT_FRACTION),
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({
      input: data,
      left: side + Math.round((photoSize - info.width) / 2),
      top: side + photoSize + Math.round((stripH - info.height) / 2),
    });
  }
  return sharp({
    create: { width: item.w, height: item.h, channels: 4, background: FRAME_COLOR },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

function shadowSvg(width: number, height: number, item: PolaroidItem): Buffer {
  const { dx, dy, blur, opacity } = SHADOW;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter>` +
      `<rect x="${SPRITE_PAD_PX + dx}" y="${SPRITE_PAD_PX + dy}" width="${item.w}" height="${item.h}" ` +
      `fill="#000" fill-opacity="${opacity}" filter="url(#b)"/></svg>`,
  );
}

/**
 * Draws one polaroid (photo, white frame, caption, shadow, tape), rotates it about its centre and
 * returns the sprite with the composite offset that keeps the frame centred where the spec says.
 */
export async function renderPolaroid(
  item: PolaroidItem,
  sourcePath: string,
  fontPath: string,
): Promise<PrintSprite> {
  const width = item.w + 2 * SPRITE_PAD_PX;
  const height = item.h + 2 * SPRITE_PAD_PX;
  const tape = tapePlacement(item);
  const flat = await sharp({
    create: { width, height, channels: 4, background: TRANSPARENT },
  })
    .composite([
      { input: shadowSvg(width, height, item), left: 0, top: 0 },
      {
        input: await renderCard(item, sourcePath, fontPath),
        left: SPRITE_PAD_PX,
        top: SPRITE_PAD_PX,
      },
      {
        input: tapeSvg(tape.angle),
        left: Math.round(tape.cx - TAPE.w / 2),
        top: Math.round(tape.cy - TAPE.h / 2),
      },
    ])
    .png()
    .toBuffer();
  const { data, info } = await sharp(flat)
    .rotate(item.rotationDeg, { background: TRANSPARENT })
    .png()
    .toBuffer({ resolveWithObject: true });
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return {
    input: data,
    left: Math.round(cx - info.width / 2),
    top: Math.round(cy - info.height / 2),
  };
}
```

Create `src/server/renderers/polaroid.ts`:

```ts
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { CollageFormat } from "@/lib/schemas/collage";
import { PolaroidSpec } from "@/lib/schemas/polaroid";
import { AppError } from "@/server/http/errors";
import { renderPaper } from "./polaroidPaper";
import { renderPolaroid } from "./polaroidPrint";

export interface RenderPolaroidArgs {
  spec: PolaroidSpec;
  sourcePaths: ReadonlyMap<string, string>;
  fontPath: string;
  outputDir: string;
  format: CollageFormat;
}

const JPEG_QUALITY = 90;
const SLIDE_BACKGROUND = "#ffffff";

/**
 * Executes a validated spec: draws the paper, composites each polaroid sequentially (bounding
 * native memory), then cuts the spread into slides. Returns slide file paths in slide order.
 */
export async function renderPolaroidSlides(args: RenderPolaroidArgs): Promise<string[]> {
  const spec = PolaroidSpec.parse(args.spec);
  const sprites: OverlayOptions[] = [];
  for (const item of spec.polaroids) {
    const sourcePath = args.sourcePaths.get(item.image);
    if (sourcePath === undefined) {
      throw new AppError("INTERNAL", 500, "Missing source image for polaroid");
    }
    sprites.push(await renderPolaroid(item, sourcePath, args.fontPath));
  }
  const { data, info } = await sharp(await renderPaper(spec))
    .composite(sprites)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ext = args.format === "jpeg" ? "jpg" : "png";
  const paths: string[] = [];
  for (let s = 0; s < spec.slide.count; s++) {
    const file = path.join(args.outputDir, `slide-${String(s + 1).padStart(2, "0")}.${ext}`);
    const slide = sharp(data, {
      raw: { width: info.width, height: info.height, channels: 3 },
    }).extract({ left: s * spec.slide.w, top: 0, width: spec.slide.w, height: spec.slide.h });
    if (args.format === "jpeg") {
      await slide
        .flatten({ background: SLIDE_BACKGROUND })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(file);
    } else {
      await slide.png().toFile(file);
    }
    paths.push(file);
  }
  return paths;
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run tests/unit/polaroidZip.test.ts tests/unit/polaroidRenderer.test.ts`
Expected: PASS (8 tests; the renderer file takes a few seconds).

Optional visual check (not committed): render 3 slides with the planner and open them to confirm the torn sheet, ruled page, tape and captions look right.

- [ ] **Step 6: Format, typecheck, lint**

Run: `npx prettier --write src/server/renderers/polaroid.ts src/server/renderers/polaroidPaper.ts src/server/renderers/polaroidPrint.ts src/server/renderers/zip.ts tests/unit/polaroidRenderer.test.ts tests/unit/polaroidZip.test.ts`
Run: `npx tsc --noEmit` (new files must be error-free) and `npx eslint src/server/renderers tests/unit/polaroidRenderer.test.ts tests/unit/polaroidZip.test.ts` (clean).

- [ ] **Step 7: Commit**

```powershell
git add assets/fonts/Caveat-Regular.ttf assets/fonts/OFL.txt src/server/renderers/polaroid.ts src/server/renderers/polaroidPaper.ts src/server/renderers/polaroidPrint.ts src/server/renderers/zip.ts tests/unit/polaroidRenderer.test.ts tests/unit/polaroidZip.test.ts package.json package-lock.json
git commit -m "feat: render polaroid carousel slides" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Worker processor, signed results and dispatch

**Files:**
- Create: `worker/processors/sources.ts`, `worker/processors/buildPolaroid.ts`, `worker/processors/collageQueue.ts`, `src/server/jobs/polaroidResult.ts`
- Modify (all clean, commit): `worker/processors/buildCollage.ts`, `src/server/jobs/collageResult.ts`, `src/app/api/jobs/[id]/route.ts`, `worker/runJob.ts`, `worker/index.ts`
- Test: `tests/unit/buildPolaroid.test.ts`, `tests/integration/polaroidJobs.test.ts`

**Interfaces:**
- Consumes: `planPolaroidCarousel`, `PolaroidWorkerInput`, `PolaroidWorkerResult`, `POLAROID_JOB_TYPE`, `POLAROID_SLIDE_*` (Task 1); `renderPolaroidSlides`, `writeZip` (Task 3); `PolaroidJobResult` and config fields `polaroidMaxSpreadPixels`/`polaroidFontPath` (Task 2).
- Produces:
  - `sources.ts`: `Progress`, `SourceDeps`, `userError(code, message): AppError`, `downloadSources(deps, { ids, ownerId, dir, config }, progress): Promise<{ stats: ImageStats[]; sourcePaths: Map<string, string> }>`
  - `buildPolaroid.ts`: `BuildPolaroidDeps`, `createBuildPolaroidProcessor(overrides?)`, `buildPolaroidProcessor`
  - `collageQueue.ts`: `createCollageDispatcher({ grid, polaroid })`, `collageDispatcher`
  - `polaroidResult.ts`: `resolvePolaroidResult(job: { ownerId: string; result: unknown }, io?): Promise<PolaroidJobResult>`
  - `collageResult.ts` now also exports `defaultIo()` and `unavailable()`

- [ ] **Step 1: Extract the shared download helpers (behaviour-preserving)**

Create `worker/processors/sources.ts`:

```ts
import path from "node:path";
import type { ImageStats } from "@/lib/planner/collage/grid/types";
import { isSupportedImageMime, type inspectImage } from "@/server/analyzers/image/metadata";
import type { Config } from "@/server/config";
import type { assetsRepo } from "@/server/db/repositories/assets";
import { AppError } from "@/server/http/errors";
import type { downloadObjectToFile } from "@/server/storage/objects";

const PROGRESS_AFTER_DOWNLOADS = 70;

export type Progress = (progress: number) => Promise<void>;

export interface SourceDeps {
  assetsRepo: Pick<typeof assetsRepo, "getForOwner">;
  downloadObjectToFile: typeof downloadObjectToFile;
  inspectImage: typeof inspectImage;
}

type SourceAsset = NonNullable<Awaited<ReturnType<SourceDeps["assetsRepo"]["getForOwner"]>>>;

export function userError(code: "VALIDATION_FAILED" | "NOT_FOUND", message: string): AppError {
  return new AppError(code, code === "NOT_FOUND" ? 404 : 400, message);
}

async function resolveSource(
  deps: SourceDeps,
  assetId: string,
  ownerId: string,
): Promise<SourceAsset> {
  const asset = await deps.assetsRepo.getForOwner(assetId, ownerId);
  if (!asset) throw userError("NOT_FOUND", "Source image not found");
  if (asset.kind !== "image" || !isSupportedImageMime(asset.contentType)) {
    throw userError("VALIDATION_FAILED", "Source asset is not a supported image");
  }
  return asset;
}

export interface Downloaded {
  stats: ImageStats[];
  sourcePaths: Map<string, string>;
}

/** Sequential on purpose: decoding is memory-heavy and collage concurrency is bounded per worker. */
export async function downloadSources(
  deps: SourceDeps,
  args: { ids: readonly string[]; ownerId: string; dir: string; config: Config },
  progress: Progress,
): Promise<Downloaded> {
  const { maxImageUploadBytes, collageMaxInputPixels } = args.config;
  const out: Downloaded = { stats: [], sourcePaths: new Map() };
  for (const [index, id] of args.ids.entries()) {
    const asset = await resolveSource(deps, id, args.ownerId);
    const file = path.join(args.dir, `source-${index}`);
    await deps.downloadObjectToFile(asset.key, file, maxImageUploadBytes);
    out.stats.push(await deps.inspectImage(file, asset.id, collageMaxInputPixels));
    out.sourcePaths.set(asset.id, file);
    await progress(Math.round(((index + 1) / args.ids.length) * PROGRESS_AFTER_DOWNLOADS));
  }
  return out;
}
```

Edit `worker/processors/buildCollage.ts`: delete the constant `PROGRESS_AFTER_DOWNLOADS`, the type aliases `Progress` and `SourceAsset`, and the definitions of `userError`, `resolveSource`, `interface Downloaded` and `downloadSources` (they now live in `sources.ts`). In the imports, change `import { inspectImage as defaultInspect, isSupportedImageMime } from "@/server/analyzers/image/metadata";` to import only `inspectImage as defaultInspect`, remove the now-unused `AppError` import, and add `import { downloadSources, userError, type Progress } from "./sources";`. Nothing else changes.

Run: `npx vitest run tests/unit/buildCollage.test.ts` then `npx tsc --noEmit`.
Expected: the existing grid processor tests still PASS and `buildCollage.ts` has no type errors or unused imports.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/buildPolaroid.test.ts`:

```ts
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";

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
  MAX_IMAGE_UPLOAD_MB: "1",
  COLLAGE_MAX_INPUT_PIXELS: "1000000",
});

vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { planPolaroidCarousel } from "@/lib/planner/collage/polaroid/plan";
import type { JobData } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";
import {
  createBuildPolaroidProcessor,
  type BuildPolaroidDeps,
} from "../../worker/processors/buildPolaroid";
import { createCollageDispatcher } from "../../worker/processors/collageQueue";
import type { RunJobDeps } from "../../worker/runJob";

const OWNER = "owner-1";
const defaultInput = {
  sourceAssetIds: ["a1", "a2", "a3"],
  slides: 2,
  slideAspect: "4:5",
  captions: ["", "Hi", ""],
  format: "png",
};

function harness(
  opts: { input?: Record<string, unknown>; overrides?: Partial<BuildPolaroidDeps> } = {},
) {
  const row: Record<string, unknown> = {
    id: "j1",
    ownerId: OWNER,
    type: "collage.polaroid",
    status: "queued",
    progress: 0,
    webhookUrl: null,
    input: opts.input ?? defaultInput,
  };
  const history: string[] = [];
  const progress: number[] = [];
  const notify = vi.fn(async () => undefined);
  const runJobDeps = {
    store: {
      get: async () => ({ ...row }),
      transition: async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        history.push(to);
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
      setProgress: async (_id: string, value: number) => {
        progress.push(value);
      },
    },
    notify,
  } as unknown as RunJobDeps;

  const assets: Record<string, { key: string; kind: string; contentType: string }> = {
    a1: { key: "uploads/owner-1/u/a.png", kind: "image", contentType: "image/png" },
    a2: { key: "uploads/owner-1/u/b.jpg", kind: "image", contentType: "image/jpeg" },
    a3: { key: "uploads/owner-1/u/c.webp", kind: "image", contentType: "image/webp" },
  };
  const downloads: { key: string; path: string }[] = [];
  const uploads: { key: string; contentType: string }[] = [];
  const registered: Record<string, unknown>[] = [];
  const renders: Parameters<BuildPolaroidDeps["renderPolaroidSlides"]>[0][] = [];
  const zips: { files: string[]; outPath: string }[] = [];
  const planSpy = vi.fn(planPolaroidCarousel);

  const deps: Partial<BuildPolaroidDeps> = {
    assetsRepo: {
      getForOwner: vi.fn(async (id: string, ownerId: string) => {
        const asset = assets[id];
        return asset && ownerId === OWNER ? { id, ownerId, ...asset } : undefined;
      }),
      register: vi.fn(async (args: Record<string, unknown>) => {
        registered.push(args);
        return { id: `out-${registered.length}`, ...args };
      }),
    } as unknown as BuildPolaroidDeps["assetsRepo"],
    downloadObjectToFile: async (key, dest) => {
      downloads.push({ key, path: dest });
      await writeFile(dest, "img");
    },
    uploadFile: async (key, _path, contentType) => {
      uploads.push({ key, contentType });
      return 100 + uploads.length;
    },
    inspectImage: async (_path, assetId) => ({
      assetId,
      widthPx: 400,
      heightPx: 300,
      pixelCount: 120_000,
    }),
    planPolaroidCarousel: planSpy,
    renderPolaroidSlides: async (args) => {
      renders.push(args);
      const ext = args.format === "jpeg" ? "jpg" : "png";
      const files: string[] = [];
      for (let s = 0; s < args.spec.slide.count; s++) {
        const file = path.join(args.outputDir, `slide-0${s + 1}.${ext}`);
        await writeFile(file, "slide");
        files.push(file);
      }
      return files;
    },
    writeZip: async (files, outPath) => {
      zips.push({ files: [...files], outPath });
      await writeFile(outPath, "zip");
    },
    runJobDeps,
    ...opts.overrides,
  };
  const bullJob = (attemptsMade = 0, maxAttempts = 3) =>
    ({
      data: { jobId: "j1", type: "collage.polaroid" },
      attemptsMade,
      opts: { attempts: maxAttempts },
    }) as unknown as Job<JobData>;
  return {
    row,
    history,
    progress,
    notify,
    downloads,
    uploads,
    registered,
    renders,
    zips,
    planSpy,
    bullJob,
    processor: createBuildPolaroidProcessor(deps),
  };
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("buildPolaroid processor", () => {
  it("runs queued -> running -> succeeded and stores asset references, not URLs", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toEqual({
      zipAssetId: "out-3",
      slideAssetIds: ["out-1", "out-2"],
      slideWidth: 1080,
      slideHeight: 1350,
      format: "png",
    });
    expect(JSON.stringify(h.row.result)).not.toContain("https://");
    expect([...h.progress]).toEqual([...h.progress].sort((a, b) => a - b));
    expect(h.row.progress).toBe(100);
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "succeeded");
  });

  it("downloads in input order and plans with ordered ids, captions, slides and aspect", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.downloads.map((d) => d.key)).toEqual([
      "uploads/owner-1/u/a.png",
      "uploads/owner-1/u/b.jpg",
      "uploads/owner-1/u/c.webp",
    ]);
    expect(h.planSpy).toHaveBeenCalledWith({
      images: [
        { assetId: "a1", caption: "" },
        { assetId: "a2", caption: "Hi" },
        { assetId: "a3", caption: "" },
      ],
      slideCount: 2,
      slideAspect: "4:5",
    });
    const render = h.renders[0];
    expect(render?.format).toBe("png");
    expect(path.isAbsolute(render?.fontPath ?? "")).toBe(true);
    expect(render?.fontPath.endsWith(path.join("assets", "fonts", "Caveat-Regular.ttf"))).toBe(true);
    expect(h.zips[0]?.files.map((f) => path.basename(f))).toEqual(["slide-01.png", "slide-02.png"]);
  });

  it("uploads deterministic keys and registers slides before the ZIP", async () => {
    const h = harness();
    await h.processor(h.bullJob());
    expect(h.uploads).toEqual([
      { key: "outputs/j1/slide-01.png", contentType: "image/png" },
      { key: "outputs/j1/slide-02.png", contentType: "image/png" },
      { key: "outputs/j1/polaroid.zip", contentType: "application/zip" },
    ]);
    expect(h.registered[0]).toEqual({
      ownerId: OWNER,
      key: "outputs/j1/slide-01.png",
      kind: "output",
      contentType: "image/png",
      sizeBytes: 101,
      metadata: { index: 0, width: 1080, height: 1350, format: "png" },
    });
    expect(h.registered[2]).toMatchObject({
      key: "outputs/j1/polaroid.zip",
      kind: "output",
      contentType: "application/zip",
      metadata: { slideCount: 2, format: "png" },
    });
  });

  it("renders JPEG slides with the matching extension and content type", async () => {
    const h = harness({ input: { ...defaultInput, format: "jpeg" } });
    await h.processor(h.bullJob());
    expect(h.uploads.slice(0, 2)).toEqual([
      { key: "outputs/j1/slide-01.jpg", contentType: "image/jpeg" },
      { key: "outputs/j1/slide-02.jpg", contentType: "image/jpeg" },
    ]);
    expect(h.row.result).toMatchObject({ format: "jpeg" });
  });

  it("reuses the same output keys when a failed attempt is retried", async () => {
    let calls = 0;
    const h = harness({
      overrides: {
        renderPolaroidSlides: async (args) => {
          calls += 1;
          if (calls === 1) throw new Error("sharp crashed at /srv/tmp/x");
          const file = path.join(args.outputDir, "slide-01.png");
          const second = path.join(args.outputDir, "slide-02.png");
          await writeFile(file, "a");
          await writeFile(second, "b");
          return [file, second];
        },
      },
    });
    await expect(h.processor(h.bullJob(0))).rejects.toThrow();
    expect(h.history).toEqual(["running", "queued"]);
    expect(h.registered).toEqual([]);
    await h.processor(h.bullJob(1));
    expect(h.history).toEqual(["running", "queued", "running", "succeeded"]);
    expect(h.registered).toHaveLength(3);
    expect(h.uploads.map((u) => u.key)).toEqual([
      "outputs/j1/slide-01.png",
      "outputs/j1/slide-02.png",
      "outputs/j1/polaroid.zip",
    ]);
  });

  it("removes the temp directory after success and after failure", async () => {
    const ok = harness();
    await ok.processor(ok.bullJob());
    expect(await exists(path.dirname(ok.downloads[0]?.path ?? ""))).toBe(false);

    const bad = harness({
      overrides: {
        renderPolaroidSlides: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(bad.processor(bad.bullJob(2))).rejects.toThrow("boom");
    expect(await exists(path.dirname(bad.downloads[0]?.path ?? ""))).toBe(false);
    expect(bad.registered).toEqual([]);
    expect(bad.uploads).toEqual([]);
    expect(bad.row).toMatchObject({ status: "failed", errorMessage: "Job failed" });
  });

  it("fails invalid media with a safe message, without retrying or storing output", async () => {
    const h = harness({
      overrides: {
        inspectImage: async () => {
          throw new AppError("VALIDATION_FAILED", 400, "Image is corrupt or exceeds the pixel limit");
        },
      },
    });
    const err = await h.processor(h.bullJob(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(h.history).toEqual(["running", "failed"]);
    expect(h.row).toMatchObject({
      errorCode: "VALIDATION_FAILED",
      errorMessage: "Image is corrupt or exceeds the pixel limit",
    });
    expect(h.registered).toEqual([]);
    expect(h.uploads).toEqual([]);
  });

  it("rejects invalid stored input before downloading anything", async () => {
    const h = harness({ input: { ...defaultInput, captions: ["only one"] } });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "VALIDATION_FAILED" });
    expect(h.downloads).toEqual([]);
  });

  it("fails a missing or foreign source image as NOT_FOUND", async () => {
    const h = harness({ input: { ...defaultInput, sourceAssetIds: ["a1", "ghost", "a3"] } });
    await expect(h.processor(h.bullJob(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.row).toMatchObject({ status: "failed", errorCode: "NOT_FOUND" });
    expect(h.renders).toEqual([]);
  });
});

describe("collage queue dispatcher", () => {
  const job = (type: string) => ({ data: { jobId: "j", type } }) as unknown as Job<JobData>;

  it("sends polaroid jobs to the polaroid processor and everything else to the grid one", async () => {
    const grid = vi.fn(async () => undefined);
    const polaroid = vi.fn(async () => undefined);
    const dispatch = createCollageDispatcher({ grid, polaroid });
    await dispatch(job("collage.polaroid"));
    await dispatch(job("collage.build"));
    expect(polaroid).toHaveBeenCalledTimes(1);
    expect(grid).toHaveBeenCalledTimes(1);
  });
});
```

Create `tests/integration/polaroidJobs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

const mocks = vi.hoisted(() => ({
  findActiveByHash: vi.fn(),
  getForOwner: vi.fn(),
  get: vi.fn(),
  transition: vi.fn(),
  setProgress: vi.fn(),
  getAsset: vi.fn(),
  presignGet: vi.fn(),
  deliverWebhook: vi.fn(),
}));
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({
  jobsRepo: {
    getForOwner: mocks.getForOwner,
    get: mocks.get,
    transition: mocks.transition,
    setProgress: mocks.setProgress,
  },
}));
vi.mock("@/server/db/repositories/assets", () => ({
  assetsRepo: { getForOwner: mocks.getAsset },
}));
vi.mock("@/server/storage/presign", () => ({ presignGet: mocks.presignGet }));
vi.mock("@/server/webhooks/deliver", () => ({ deliverWebhook: mocks.deliverWebhook }));
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { PolaroidJobResult } from "@/lib/schemas/api";
import { runJob } from "../../worker/runJob";

const OWNER = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const auth = { Authorization: "Bearer ak_test" };
const KEYS: Record<string, string> = {
  "asset-zip": `outputs/${JOB_ID}/polaroid.zip`,
  "asset-s1": `outputs/${JOB_ID}/slide-01.png`,
  "asset-s2": `outputs/${JOB_ID}/slide-02.png`,
};
const internalResult = {
  zipAssetId: "asset-zip",
  slideAssetIds: ["asset-s1", "asset-s2"],
  slideWidth: 1080,
  slideHeight: 1350,
  format: "png",
};

function jobRow(patch: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    ownerId: OWNER,
    type: "collage.polaroid",
    status: "succeeded",
    progress: 100,
    result: internalResult,
    errorCode: null,
    errorMessage: null,
    webhookUrl: null,
    ...patch,
  };
}

let urlCounter = 0;
beforeEach(() => {
  urlCounter = 0;
  mocks.findActiveByHash.mockReset().mockResolvedValue({ id: OWNER, name: "t" });
  mocks.getForOwner.mockReset();
  mocks.get.mockReset();
  mocks.transition.mockReset();
  mocks.setProgress.mockReset();
  mocks.getAsset.mockReset().mockImplementation(async (id: string, owner: string) => {
    const key = KEYS[id];
    return key && owner === OWNER ? { id, key, kind: "output", ownerId: OWNER } : undefined;
  });
  mocks.presignGet.mockReset().mockImplementation(async (key: string) => {
    urlCounter += 1;
    return `https://minio.example/b/${key}?sig=${urlCounter}`;
  });
  mocks.deliverWebhook.mockReset().mockResolvedValue(true);
});

describe("GET /api/jobs/:id for polaroid jobs", () => {
  const call = async () => {
    const { GET } = await import("@/app/api/jobs/[id]/route");
    return GET(new Request(`http://x/api/jobs/${JOB_ID}`, { headers: auth }), {
      params: Promise.resolve({ id: JOB_ID }),
    });
  };

  it("404s for another owner's job without touching assets", async () => {
    mocks.getForOwner.mockResolvedValue(undefined);
    expect((await call()).status).toBe(404);
    expect(mocks.getAsset).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "failed"])("omits the result while %s", async (status) => {
    mocks.getForOwner.mockResolvedValue(jobRow({ status, progress: 30, result: null }));
    const res = await call();
    expect((await res.json()).result).toBeNull();
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("returns signed slide and ZIP URLs without asset IDs", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const json = await (await call()).json();
    expect(PolaroidJobResult.safeParse(json.result).success).toBe(true);
    expect(json.result.output).toMatchObject({
      slideCount: 2,
      slideWidth: 1080,
      slideHeight: 1350,
      slideFormat: "png",
      expiresInSec: 900,
    });
    expect(json.result.output.zipUrl).toContain("polaroid.zip");
    expect(json.result.output.slides.map((s: { index: number }) => s.index)).toEqual([0, 1]);
    expect(json.result.output.slides[1].url).toContain("slide-02.png");
    const text = JSON.stringify(json);
    for (const hidden of ["asset-zip", "asset-s1", "zipAssetId", "slideAssetIds"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("signs fresh URLs on every poll", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    const first = (await (await call()).json()).result.output.zipUrl;
    const second = (await (await call()).json()).result.output.zipUrl;
    expect(first).not.toBe(second);
  });

  it.each([
    ["a missing ZIP asset", async (id: string) => (id === "asset-zip" ? undefined : slide(id))],
    ["a non-output slide", async (id: string) => (id === "asset-s2" ? { ...slide(id), kind: "image" } : slide(id))],
  ])("does not sign when %s cannot be verified", async (_label, resolve) => {
    mocks.getForOwner.mockResolvedValue(jobRow());
    mocks.getAsset.mockImplementation(resolve);
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.presignGet).not.toHaveBeenCalled();
  });

  it("does not sign when the stored result is malformed", async () => {
    mocks.getForOwner.mockResolvedValue(jobRow({ result: { note: "x" } }));
    expect((await call()).status).toBe(500);
    expect(mocks.getAsset).not.toHaveBeenCalled();
  });
});

function slide(id: string) {
  return { id, key: KEYS[id], kind: "output", ownerId: OWNER };
}

describe("polaroid webhook delivery", () => {
  function store(initial: Record<string, unknown>) {
    const row = { ...initial };
    mocks.get.mockImplementation(async () => ({ ...row }));
    mocks.transition.mockImplementation(
      async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
    );
    mocks.setProgress.mockResolvedValue(undefined);
  }
  const args = { jobId: JOB_ID, attemptsMade: 0, maxAttempts: 3 };
  const queued = () =>
    jobRow({ status: "queued", result: null, webhookUrl: "https://hooks.example/x" });

  it("lists the ZIP first, then each slide, for a succeeded job", async () => {
    store(queued());
    await runJob(args, async () => internalResult);
    const { event } = mocks.deliverWebhook.mock.calls[0][0];
    expect(event).toMatchObject({ type: "collage.polaroid", status: "succeeded" });
    expect(event.resultUrls).toHaveLength(3);
    expect(event.resultUrls[0]).toContain("polaroid.zip");
    expect(event.resultUrls[1]).toContain("slide-01.png");
    expect(event.resultUrls[2]).toContain("slide-02.png");
  });

  it("sends empty resultUrls when an output asset cannot be verified", async () => {
    store(queued());
    mocks.getAsset.mockResolvedValue(undefined);
    await runJob(args, async () => internalResult);
    expect(mocks.presignGet).not.toHaveBeenCalled();
    expect(mocks.deliverWebhook.mock.calls[0][0].event.resultUrls).toEqual([]);
  });

  it("sends no result URLs for a failed job", async () => {
    store(queued());
    await expect(
      runJob({ ...args, attemptsMade: 2 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(mocks.deliverWebhook.mock.calls[0][0].event).toMatchObject({
      status: "failed",
      resultUrls: [],
    });
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/unit/buildPolaroid.test.ts tests/integration/polaroidJobs.test.ts`
Expected: FAIL (missing `buildPolaroid`, `collageQueue`, `polaroidResult`).

- [ ] **Step 4: Implement the processor, dispatcher and results**

Create `worker/processors/buildPolaroid.ts`:

```ts
import { mkdtemp as fsMkdtemp, rm as fsRm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Job } from "bullmq";
import {
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_WIDTH_PX,
} from "@/lib/planner/collage/polaroid/defaults";
import { planPolaroidCarousel as defaultPlan } from "@/lib/planner/collage/polaroid/plan";
import type { JobData } from "@/lib/schemas/job";
import { PolaroidWorkerInput, type PolaroidWorkerResult } from "@/lib/schemas/polaroid";
import { inspectImage as defaultInspect } from "@/server/analyzers/image/metadata";
import { getConfig } from "@/server/config";
import { assetsRepo as defaultAssetsRepo } from "@/server/db/repositories/assets";
import { renderPolaroidSlides as defaultRender } from "@/server/renderers/polaroid";
import { writeZip as defaultWriteZip } from "@/server/renderers/zip";
import {
  downloadObjectToFile as defaultDownload,
  uploadFile as defaultUpload,
} from "@/server/storage/objects";
import { runJob as defaultRunJob, type RunJobDeps } from "../runJob";
import { downloadSources, userError } from "./sources";

export interface BuildPolaroidDeps {
  assetsRepo: Pick<typeof defaultAssetsRepo, "getForOwner" | "register">;
  downloadObjectToFile: typeof defaultDownload;
  uploadFile: typeof defaultUpload;
  inspectImage: typeof defaultInspect;
  planPolaroidCarousel: typeof defaultPlan;
  renderPolaroidSlides: typeof defaultRender;
  writeZip: typeof defaultWriteZip;
  mkdtemp: typeof fsMkdtemp;
  rm: typeof fsRm;
  runJob: typeof defaultRunJob;
  runJobDeps?: RunJobDeps;
}

const defaultDeps: BuildPolaroidDeps = {
  assetsRepo: defaultAssetsRepo,
  downloadObjectToFile: defaultDownload,
  uploadFile: defaultUpload,
  inspectImage: defaultInspect,
  planPolaroidCarousel: defaultPlan,
  renderPolaroidSlides: defaultRender,
  writeZip: defaultWriteZip,
  mkdtemp: fsMkdtemp,
  rm: fsRm,
  runJob: defaultRunJob,
};

const TEMP_PREFIX = "polaroid-";
const PROGRESS_AFTER_PLAN = 72;
const PROGRESS_AFTER_RENDER = 90;
const CONTENT_TYPES = { png: "image/png", jpeg: "image/jpeg" } as const;
const ZIP_CONTENT_TYPE = "application/zip";

function parseInput(raw: unknown): PolaroidWorkerInput {
  const parsed = PolaroidWorkerInput.safeParse(raw);
  if (!parsed.success) throw userError("VALIDATION_FAILED", "Polaroid job input is invalid");
  return parsed.data;
}

// Limits were checked at creation; re-checking here guards against config changes and tampering.
function checkSpread(input: PolaroidWorkerInput, maxPixels: number): void {
  const height = POLAROID_SLIDE_HEIGHT_PX[input.slideAspect];
  if (POLAROID_SLIDE_WIDTH_PX * input.slides * height > maxPixels) {
    throw userError("VALIDATION_FAILED", "Carousel exceeds the configured size limit");
  }
}

interface StoreArgs {
  ownerId: string;
  key: string;
  filePath: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

/** Fixed keys per job: a retry overwrites the object and re-registers the same asset. */
async function storeOutput(deps: BuildPolaroidDeps, args: StoreArgs): Promise<string> {
  const sizeBytes = await deps.uploadFile(args.key, args.filePath, args.contentType);
  const asset = await deps.assetsRepo.register({
    ownerId: args.ownerId,
    key: args.key,
    kind: "output",
    contentType: args.contentType,
    sizeBytes,
    metadata: args.metadata,
  });
  return asset.id;
}

async function storeOutputs(
  deps: BuildPolaroidDeps,
  args: {
    jobId: string;
    ownerId: string;
    slidePaths: readonly string[];
    zipPath: string;
    format: PolaroidWorkerInput["format"];
    slideWidth: number;
    slideHeight: number;
  },
): Promise<PolaroidWorkerResult> {
  const { jobId, ownerId, format, slideWidth, slideHeight } = args;
  const slideAssetIds: string[] = [];
  for (const [index, filePath] of args.slidePaths.entries()) {
    slideAssetIds.push(
      await storeOutput(deps, {
        ownerId,
        key: `outputs/${jobId}/${path.basename(filePath)}`,
        filePath,
        contentType: CONTENT_TYPES[format],
        metadata: { index, width: slideWidth, height: slideHeight, format },
      }),
    );
  }
  const zipAssetId = await storeOutput(deps, {
    ownerId,
    key: `outputs/${jobId}/polaroid.zip`,
    filePath: args.zipPath,
    contentType: ZIP_CONTENT_TYPE,
    metadata: { slideCount: args.slidePaths.length, format },
  });
  return { zipAssetId, slideAssetIds, slideWidth, slideHeight, format };
}

async function buildPolaroid(
  deps: BuildPolaroidDeps,
  ctx: {
    job: { id: string; ownerId: string; input: unknown };
    progress: (progress: number) => Promise<void>;
  },
): Promise<PolaroidWorkerResult> {
  const input = parseInput(ctx.job.input);
  const config = getConfig();
  checkSpread(input, config.polaroidMaxSpreadPixels);
  const dir = await deps.mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
  try {
    const { stats, sourcePaths } = await downloadSources(
      deps,
      { ids: input.sourceAssetIds, ownerId: ctx.job.ownerId, dir, config },
      ctx.progress,
    );
    const spec = deps.planPolaroidCarousel({
      images: stats.map((s, i) => ({ assetId: s.assetId, caption: input.captions[i] ?? "" })),
      slideCount: input.slides,
      slideAspect: input.slideAspect,
    });
    await ctx.progress(PROGRESS_AFTER_PLAN);

    const slidePaths = await deps.renderPolaroidSlides({
      spec,
      sourcePaths,
      fontPath: path.resolve(config.polaroidFontPath),
      outputDir: dir,
      format: input.format,
    });
    const zipPath = path.join(dir, "polaroid.zip");
    await deps.writeZip(slidePaths, zipPath);
    await ctx.progress(PROGRESS_AFTER_RENDER);

    return await storeOutputs(deps, {
      jobId: ctx.job.id,
      ownerId: ctx.job.ownerId,
      slidePaths,
      zipPath,
      format: input.format,
      slideWidth: spec.slide.w,
      slideHeight: spec.slide.h,
    });
  } finally {
    await deps.rm(dir, { recursive: true, force: true });
  }
}

export function createBuildPolaroidProcessor(
  overrides: Partial<BuildPolaroidDeps> = {},
): (job: Job<JobData>) => Promise<void> {
  const deps: BuildPolaroidDeps = { ...defaultDeps, ...overrides };
  return async (job) => {
    await deps.runJob(
      {
        jobId: job.data.jobId,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      },
      (ctx) => buildPolaroid(deps, ctx),
      deps.runJobDeps,
    );
  };
}

export const buildPolaroidProcessor = createBuildPolaroidProcessor();
```

Create `worker/processors/collageQueue.ts`:

```ts
import type { Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";
import { buildCollageProcessor } from "./buildCollage";
import { buildPolaroidProcessor } from "./buildPolaroid";

type Processor = (job: Job<JobData>) => Promise<void>;

/** The `collage` queue carries several job types; route each to its processor by type. */
export function createCollageDispatcher(handlers: {
  grid: Processor;
  polaroid: Processor;
}): Processor {
  return (job) =>
    job.data.type === POLAROID_JOB_TYPE ? handlers.polaroid(job) : handlers.grid(job);
}

export const collageDispatcher = createCollageDispatcher({
  grid: buildCollageProcessor,
  polaroid: buildPolaroidProcessor,
});
```

Edit `worker/index.ts`: replace `import { buildCollageProcessor } from "./processors/buildCollage";` with `import { collageDispatcher } from "./processors/collageQueue";` and `collage: buildCollageProcessor,` with `collage: collageDispatcher,`.

Edit `src/server/jobs/collageResult.ts`: change `function defaultIo(): CollageResultIo {` to `export function defaultIo(): CollageResultIo {` and `function unavailable(): AppError {` to `export function unavailable(): AppError {`.

Create `src/server/jobs/polaroidResult.ts`:

```ts
import { PolaroidJobResult } from "@/lib/schemas/api";
import { PolaroidWorkerResult } from "@/lib/schemas/polaroid";
import { defaultIo, unavailable, type CollageResultIo } from "./collageResult";

/**
 * Turns a succeeded polaroid job's stored result (asset references) into the public result with
 * freshly signed URLs. Every asset must be an output owned by the job owner, so a tampered result
 * cannot leak another owner's object. Never exposes asset IDs or keys.
 */
export async function resolvePolaroidResult(
  job: { ownerId: string; result: unknown },
  io: CollageResultIo = defaultIo(),
): Promise<PolaroidJobResult> {
  const stored = PolaroidWorkerResult.safeParse(job.result);
  if (!stored.success) throw unavailable();
  const { zipAssetId, slideAssetIds, slideWidth, slideHeight, format } = stored.data;
  const assets = await Promise.all(
    [zipAssetId, ...slideAssetIds].map((id) => io.getAsset(id, job.ownerId)),
  );
  const keys: string[] = [];
  for (const asset of assets) {
    if (!asset || asset.kind !== "output") throw unavailable();
    keys.push(asset.key);
  }
  const [zipUrl, ...slideUrls] = await Promise.all(keys.map((key) => io.presign(key)));
  return PolaroidJobResult.parse({
    output: {
      slideCount: slideUrls.length,
      slideWidth,
      slideHeight,
      slideFormat: format,
      zipUrl,
      slides: slideUrls.map((url, index) => ({ index, url })),
      expiresInSec: io.expiresInSec,
    },
  });
}
```

Edit `src/app/api/jobs/[id]/route.ts`: add imports `import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";` and `import { resolvePolaroidResult } from "@/server/jobs/polaroidResult";`, and replace

```ts
  if (job.type === COLLAGE_JOB_TYPE) {
    result = job.status === "succeeded" ? await resolveCollageResult(job) : null;
  }
```

with

```ts
  if (job.type === COLLAGE_JOB_TYPE) {
    result = job.status === "succeeded" ? await resolveCollageResult(job) : null;
  } else if (job.type === POLAROID_JOB_TYPE) {
    result = job.status === "succeeded" ? await resolvePolaroidResult(job) : null;
  }
```

Edit `worker/runJob.ts`: add imports `import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";` and `import { resolvePolaroidResult } from "@/server/jobs/polaroidResult";`, and replace `resultUrlsFor` with:

```ts
/** Signs URLs at delivery time; a result that cannot be resolved must not block the webhook. */
async function resultUrlsFor(job: JobRow, status: JobStatus): Promise<string[]> {
  if (status !== "succeeded") return [];
  try {
    if (job.type === COLLAGE_JOB_TYPE) {
      const { output } = await resolveCollageResult(job);
      return [output.downloadUrl];
    }
    if (job.type === POLAROID_JOB_TYPE) {
      const { output } = await resolvePolaroidResult(job);
      return [output.zipUrl, ...output.slides.map((slide) => slide.url)];
    }
    return [];
  } catch (err) {
    logger.warn({ jobId: job.id, err }, "could not resolve webhook result URL");
    return [];
  }
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run tests/unit/buildPolaroid.test.ts tests/integration/polaroidJobs.test.ts tests/unit/buildCollage.test.ts tests/integration/collages.test.ts tests/unit/runJob.test.ts`
Expected: PASS (grid and polaroid paths both green).

- [ ] **Step 6: Format, typecheck, lint**

Run: `npx prettier --write worker src/server/jobs "src/app/api/jobs/[id]/route.ts" tests/unit/buildPolaroid.test.ts tests/integration/polaroidJobs.test.ts`
Run: `npx tsc --noEmit` (no new errors beyond the known route.ts call-site errors from Task 2) and `npx eslint worker src/server/jobs "src/app/api/jobs/[id]/route.ts" tests/unit/buildPolaroid.test.ts tests/integration/polaroidJobs.test.ts`.

- [ ] **Step 7: Commit**

Run `git status --short worker src/server/jobs "src/app/api/jobs/[id]/route.ts"` and confirm only the files listed in this task appear, then:

```powershell
git add worker/processors/sources.ts worker/processors/buildPolaroid.ts worker/processors/collageQueue.ts worker/processors/buildCollage.ts worker/index.ts worker/runJob.ts src/server/jobs/polaroidResult.ts src/server/jobs/collageResult.ts "src/app/api/jobs/[id]/route.ts" tests/unit/buildPolaroid.test.ts tests/integration/polaroidJobs.test.ts
git commit -m "feat: process polaroid carousel jobs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Create-collage route accepts `mode: "polaroid"`

**Files:**
- Modify (pre-modified, do not stage): `src/app/api/collages/route.ts`
- Test (create, commit): `tests/integration/polaroidCollages.test.ts`

**Interfaces:**
- Consumes: `CreateCollageBody` union (Task 2), `resolvePolaroidOptions`/`ResolvedPolaroidOptions` (Task 2), `POLAROID_JOB_TYPE`, `PolaroidWorkerInput` (Task 1), `POLAROID_SLIDE_*` (Task 1), config `polaroidMaxSpreadPixels` (Task 2), `enqueueJob`.
- Produces: `POST /api/collages` with `mode: "polaroid"` returns `202 { jobId }` and enqueues `{ queue: "collage", type: "collage.polaroid", ownerId, input: PolaroidWorkerInput, webhookUrl? }`. Grid behaviour and error order are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/polaroidCollages.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  MAX_IMAGE_UPLOAD_MB: "1",
});

const mocks = vi.hoisted(() => ({
  findActiveByHash: vi.fn(),
  enqueueJob: vi.fn(),
  headObject: vi.fn(),
  register: vi.fn(),
}));
const { findActiveByHash, enqueueJob, headObject, register } = mocks;
vi.mock("@/server/db/repositories/apiKeys", () => ({
  apiKeysRepo: { findActiveByHash: mocks.findActiveByHash },
}));
vi.mock("@/server/db/repositories/jobs", () => ({ jobsRepo: { getForOwner: vi.fn() } }));
vi.mock("@/server/db/repositories/assets", () => ({ assetsRepo: { register: mocks.register } }));
vi.mock("@/server/queue/queues", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/server/storage/objects", () => ({ headObject: mocks.headObject }));
vi.mock("@/server/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const ownerId = "11111111-1111-1111-1111-111111111111";
const auth = { Authorization: "Bearer ak_test" };
const key = (name: string, owner = ownerId) => `uploads/${owner}/up-1/${name}`;
const keys = (count: number) => Array.from({ length: count }, (_, i) => key(`${i}.png`));
const body = (
  count: number,
  polaroid: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  images: keys(count),
  mode: "polaroid",
  polaroid: { slideAspect: "4:5", ...polaroid },
  ...extra,
});

const call = async (payload: unknown, headers: Record<string, string> = auth) => {
  const { POST } = await import("@/app/api/collages/route");
  return POST(
    new Request("http://x/api/collages", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
};

const expectRejected = async (res: Response, status: number, code: string) => {
  expect(res.status).toBe(status);
  expect((await res.json()).error.code).toBe(code);
  expect(register).not.toHaveBeenCalled();
  expect(enqueueJob).not.toHaveBeenCalled();
};

beforeEach(() => {
  findActiveByHash.mockReset().mockResolvedValue({ id: ownerId, name: "t" });
  enqueueJob.mockReset().mockResolvedValue({ id: "job-1" });
  headObject.mockReset().mockResolvedValue({ contentType: "image/png", sizeBytes: 1000 });
  register.mockReset().mockImplementation(async (args: { key: string }) => ({
    id: `asset-${args.key.split("/").pop()}`,
  }));
});

describe("POST /api/collages (polaroid)", () => {
  it("rejects missing credentials", async () => {
    await expectRejected(await call(body(4), {}), 401, "UNAUTHORIZED");
  });

  it("queues a collage.polaroid job with resolved options", async () => {
    const payload = body(
      4,
      { captions: [" Summer ", "b", "", "d"] },
      { format: "jpeg", webhookUrl: "https://example.com/hook" },
    );
    const res = await call(payload);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "collage",
      type: "collage.polaroid",
      ownerId,
      input: {
        sourceAssetIds: ["asset-0.png", "asset-1.png", "asset-2.png", "asset-3.png"],
        slides: 2,
        slideAspect: "4:5",
        captions: ["Summer", "b", "", "d"],
        format: "jpeg",
      },
      webhookUrl: "https://example.com/hook",
    });
  });

  it("derives slides from the image count and blanks missing captions", async () => {
    await call(body(7));
    const [args] = enqueueJob.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(args.input).toMatchObject({
      slides: 3,
      captions: Array.from({ length: 7 }, () => ""),
      format: "png",
    });
    expect(args).not.toHaveProperty("webhookUrl");
  });

  it("keeps an explicit slide count and registers the images in order", async () => {
    await call(body(4, { slides: 4, slideAspect: "1:1" }));
    const [args] = enqueueJob.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(args.input).toMatchObject({ slides: 4, slideAspect: "1:1" });
    expect(register).toHaveBeenCalledTimes(4);
    expect(register).toHaveBeenNthCalledWith(1, {
      ownerId,
      kind: "image",
      key: key("0.png"),
      contentType: "image/png",
      sizeBytes: 1000,
    });
    expect(register.mock.calls.map(([a]) => (a as { key: string }).key)).toEqual(keys(4));
  });

  it("rejects fewer images than slides without registering anything", async () => {
    const res = await call(body(2, { slides: 3 }));
    await expectRejected(res, 400, "VALIDATION_FAILED");
  });

  it("rejects more images than the configured maximum", async () => {
    await expectRejected(await call(body(21, { slides: 10 })), 400, "VALIDATION_FAILED");
  });

  it("hides keys outside the caller's upload namespace", async () => {
    const other = "99999999-9999-9999-9999-999999999999";
    const payload = { ...body(2), images: [key("0.png"), key("1.png", other)] };
    await expectRejected(await call(payload), 404, "NOT_FOUND");
  });

  it("rejects an unsupported stored content type", async () => {
    headObject.mockResolvedValue({ contentType: "application/pdf", sizeBytes: 1000 });
    await expectRejected(await call(body(2)), 400, "VALIDATION_FAILED");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/integration/polaroidCollages.test.ts`
Expected: FAIL (the route still treats every body as a grid body, so `body.canvas` is undefined and the handler throws).

- [ ] **Step 3: Edit `src/app/api/collages/route.ts`**

1. Add imports below the existing `@/lib/schemas/...` imports:

```ts
import {
  POLAROID_SLIDE_HEIGHT_PX,
  POLAROID_SLIDE_WIDTH_PX,
} from "@/lib/planner/collage/polaroid/defaults";
import {
  resolvePolaroidOptions,
  type ResolvedPolaroidOptions,
} from "@/lib/planner/collage/polaroid/options";
import { POLAROID_JOB_TYPE, type PolaroidWorkerInput } from "@/lib/schemas/polaroid";
```

2. Replace the whole `checkLimits` function with:

```ts
type GridBody = Extract<CreateCollageBody, { mode: "grid" }>;
type PolaroidBody = Extract<CreateCollageBody, { mode: "polaroid" }>;

function checkImageCount(count: number): void {
  const { collageMaxImages } = getConfig();
  if (count > collageMaxImages) {
    throw invalid(`A collage accepts at most ${collageMaxImages} images`, { collageMaxImages });
  }
}

function checkCanvasLimits(canvas: GridBody["canvas"]): void {
  const { collageMaxCanvasPixels, collageMaxDimension } = getConfig();
  const { w, h } = canvas;
  if (w > collageMaxDimension || h > collageMaxDimension) {
    throw invalid(`Canvas sides must not exceed ${collageMaxDimension} px`, {
      collageMaxDimension,
    });
  }
  if (w * h > collageMaxCanvasPixels) {
    throw invalid(`Canvas must not exceed ${collageMaxCanvasPixels} pixels`, {
      collageMaxCanvasPixels,
    });
  }
}

function checkSpreadLimit(options: ResolvedPolaroidOptions): void {
  const { polaroidMaxSpreadPixels } = getConfig();
  const height = POLAROID_SLIDE_HEIGHT_PX[options.slideAspect];
  if (POLAROID_SLIDE_WIDTH_PX * options.slides * height > polaroidMaxSpreadPixels) {
    throw invalid(`Carousel must not exceed ${polaroidMaxSpreadPixels} pixels`, {
      polaroidMaxSpreadPixels,
    });
  }
}
```

3. Change `async function resolveTemplate(body: CreateCollageBody)` to `async function resolveTemplate(body: GridBody)`.

4. Replace everything from `export const POST = withApi(` to the end of the file with:

```ts
async function registerImages(images: readonly string[], ownerId: string): Promise<string[]> {
  for (const key of images) checkOwnedKey(key, ownerId);
  const verified = await Promise.all(images.map(verifyImage));
  const sourceAssetIds: string[] = [];
  for (const image of verified) {
    const asset = await assetsRepo.register({ ownerId, kind: "image", ...image });
    sourceAssetIds.push(asset.id);
  }
  return sourceAssetIds;
}

async function createGridJob(body: GridBody, ownerId: string) {
  checkImageCount(body.images.length);
  checkCanvasLimits(body.canvas);
  const template = await resolveTemplate(body);
  const sourceAssetIds = await registerImages(body.images, ownerId);
  const input: CollageWorkerInput = {
    sourceAssetIds,
    style: body.style,
    ...(template !== undefined && { template }),
    canvas: body.canvas,
    format: body.format,
  };
  return enqueueJob({
    queue: "collage",
    type: "collage.build",
    ownerId,
    input,
    ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
  });
}

async function createPolaroidJob(body: PolaroidBody, ownerId: string) {
  checkImageCount(body.images.length);
  const options = resolvePolaroidOptions(body.polaroid, body.images.length);
  checkSpreadLimit(options);
  const sourceAssetIds = await registerImages(body.images, ownerId);
  const input: PolaroidWorkerInput = { sourceAssetIds, ...options, format: body.format };
  return enqueueJob({
    queue: "collage",
    type: POLAROID_JOB_TYPE,
    ownerId,
    input,
    ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
  });
}

export const POST = withApi({ auth: "apiKey", body: CreateCollageBody }, async ({ body, ctx }) => {
  const ownerId = requirePrincipal(ctx).id;
  const job =
    body.mode === "polaroid"
      ? await createPolaroidJob(body, ownerId)
      : await createGridJob(body, ownerId);
  const json: CreateCollageResponse = { jobId: job.id };
  return { status: 202, json };
});
```

- [ ] **Step 4: Run and confirm pass, with grid regression**

Run: `npx vitest run tests/integration/polaroidCollages.test.ts tests/integration/routes.test.ts tests/unit/schemas.test.ts`
Expected: PASS (polaroid cases and every existing grid route case).
Run: `npx tsc --noEmit`. Expected: no errors (the Task 2 call-site errors are gone).

- [ ] **Step 5: Format, lint, commit**

Run: `npx prettier --write src/app/api/collages/route.ts tests/integration/polaroidCollages.test.ts` and `npx eslint src/app/api/collages/route.ts tests/integration/polaroidCollages.test.ts`.

```powershell
git add tests/integration/polaroidCollages.test.ts
git commit -m "test: cover polaroid collage creation route" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

(`route.ts` is pre-modified and stays uncommitted by design.)

---

### Task 6: Create form, carousel preview and e2e

**Files:**
- Create: `src/features/collage/polaroidForm.ts`, `src/components/collage/PolaroidOptionsFields.tsx`, `src/components/collage/PolaroidResult.tsx`, `tests/unit/polaroidForm.test.ts`, `tests/e2e/polaroid.spec.ts`
- Modify (all pre-modified, do not stage): `src/features/collage/form.ts`, `src/components/collage/CollageOptionsFields.tsx`, `src/components/collage/CollageCreateForm.tsx`, `src/components/collage/CollageStatus.tsx`

**Interfaces:**
- Consumes: `CreateCollageBody`, `PolaroidJobResult` (Task 2); `defaultSlideCount`, `slideCountProblem`, `POLAROID_MIN_SLIDES`, `POLAROID_MAX_SLIDES`, `POLAROID_MAX_CAPTION_CHARS` (Task 1); `PolaroidAspect`, `POLAROID_JOB_TYPE` (Task 1).
- Produces:
  - `polaroidForm.ts`: `CollageMode`, `PolaroidFormValues`, `POLAROID_FORM_DEFAULTS`, `SLIDE_ASPECT_OPTIONS`, `effectiveSlides(slides, imageCount)`, `polaroidProblems(values, imageCount)`, `buildPolaroidBody(values, keys)`
  - `CollageFormValues` now extends `PolaroidFormValues`; `buildCreateBody(values, keys)` returns the polaroid body when `values.mode === "polaroid"`
  - Components `ModeSwitch`, `PolaroidOptionsFields`, `PolaroidResult`; `CollageOptionsFields.tsx` also exports `Radio`, `SectionHeading`, `OutputFormatSection`

- [ ] **Step 1: Write the failing form test**

Create `tests/unit/polaroidForm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COLLAGE_FORM_DEFAULTS,
  buildCreateBody,
  createCollageFormSchema,
  type CollageFormValues,
} from "@/features/collage/form";
import { effectiveSlides } from "@/features/collage/polaroidForm";
import type { CollageLimits } from "@/features/collage/limits";

const MB = 1024 * 1024;
const limits: CollageLimits = {
  maxImages: 20,
  maxImageUploadBytes: 2 * MB,
  maxCanvasPixels: 4_000_000,
  maxCanvasDimension: 3000,
};
const schema = createCollageFormSchema(limits, []);

const file = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
const values = (count: number, overrides: Partial<CollageFormValues> = {}): CollageFormValues => ({
  ...COLLAGE_FORM_DEFAULTS,
  mode: "polaroid",
  files: Array.from({ length: count }, (_, i) => file(`${i}.png`)),
  captions: Array.from({ length: count }, () => ""),
  ...overrides,
});
const issues = (v: CollageFormValues) => {
  const result = schema.safeParse(v);
  return result.success
    ? []
    : result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
};

describe("polaroid form validation", () => {
  it("accepts auto slides and ignores canvas and template fields", () => {
    expect(issues(values(4))).toEqual([]);
    expect(issues(values(4, { preset: "custom", width: Number.NaN, style: "template" }))).toEqual(
      [],
    );
  });

  it("ignores polaroid fields in grid mode", () => {
    const grid = { ...values(1), mode: "grid" as const, slides: 99 };
    expect(issues(grid)).toEqual([]);
  });

  it("limits slides to whole numbers from 2 to 10", () => {
    for (const slides of [1, 11, 2.5]) {
      expect(issues(values(12, { slides }))).toEqual([
        { path: "slides", message: "Choose 2 to 10 slides" },
      ]);
    }
    expect(issues(values(12, { slides: 10 }))).toEqual([]);
  });

  it("needs at least one image per slide, including the automatic count", () => {
    expect(issues(values(1))[0]).toEqual({
      path: "slides",
      message: "2 slides need at least 2 images",
    });
    expect(issues(values(3, { slides: 4 }))[0]?.message).toBe("4 slides need at least 4 images");
    expect(issues(values(13, { slides: 2 }))[0]?.message).toBe("2 slides hold at most 12 images");
  });

  it("limits each caption to 60 characters", () => {
    const captions = ["", "x".repeat(61), "", ""];
    expect(issues(values(4, { captions }))).toEqual([
      { path: "captions.1", message: "Captions can be up to 60 characters" },
    ]);
  });
});

describe("effectiveSlides", () => {
  it("uses the automatic count only for an empty field", () => {
    expect(effectiveSlides(Number.NaN, 7)).toBe(3);
    expect(effectiveSlides(5, 7)).toBe(5);
  });
});

describe("buildCreateBody (polaroid)", () => {
  const keys = ["k0", "k1", "k2", "k3"];

  it("sends auto slides as omitted and trims captions", () => {
    const body = buildCreateBody(values(4, { captions: [" Hi ", "", "", ""] }), keys);
    expect(body).toEqual({
      images: keys,
      mode: "polaroid",
      polaroid: { slideAspect: "4:5", captions: ["Hi", "", "", ""] },
      format: "png",
    });
  });

  it("omits captions when all are blank and keeps an explicit slide count, aspect and format", () => {
    const body = buildCreateBody(
      values(4, { slides: 2, slideAspect: "1:1", format: "jpeg" }),
      keys,
    );
    expect(body).toEqual({
      images: keys,
      mode: "polaroid",
      polaroid: { slides: 2, slideAspect: "1:1" },
      format: "jpeg",
    });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/polaroidForm.test.ts`
Expected: FAIL (`@/features/collage/polaroidForm` and the new form fields do not exist).

- [ ] **Step 3: Implement the form model**

Create `src/features/collage/polaroidForm.ts`:

```ts
import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
} from "@/lib/planner/collage/polaroid/defaults";
import { defaultSlideCount, slideCountProblem } from "@/lib/planner/collage/polaroid/slides";
import { CreateCollageBody } from "@/lib/schemas/api";
import type { CollageFormat } from "@/lib/schemas/collage";
import type { PolaroidAspect } from "@/lib/schemas/polaroid";

export type CollageMode = "grid" | "polaroid";

export interface PolaroidFormValues {
  mode: CollageMode;
  /** Slide count; NaN (an empty field) means "choose automatically". */
  slides: number;
  slideAspect: PolaroidAspect;
  /** One caption per selected file, by index. */
  captions: string[];
}

export const POLAROID_FORM_DEFAULTS: PolaroidFormValues = {
  mode: "grid",
  slides: Number.NaN,
  slideAspect: "4:5",
  captions: [],
};

export const SLIDE_ASPECT_OPTIONS = [
  { id: "4:5", label: "Portrait 4:5", size: "1080×1350" },
  { id: "1:1", label: "Square 1:1", size: "1080×1080" },
] as const;

export function effectiveSlides(slides: number, imageCount: number): number {
  return Number.isNaN(slides) ? defaultSlideCount(imageCount) : slides;
}

export interface FormProblem {
  path: (string | number)[];
  message: string;
}

/** Client-side mirror of the server's polaroid checks. */
export function polaroidProblems(values: PolaroidFormValues, imageCount: number): FormProblem[] {
  const problems: FormProblem[] = [];
  const { slides } = values;
  const outOfRange =
    !Number.isNaN(slides) &&
    (!Number.isInteger(slides) || slides < POLAROID_MIN_SLIDES || slides > POLAROID_MAX_SLIDES);
  if (outOfRange) {
    problems.push({
      path: ["slides"],
      message: `Choose ${POLAROID_MIN_SLIDES} to ${POLAROID_MAX_SLIDES} slides`,
    });
  } else if (imageCount > 0) {
    const problem = slideCountProblem(imageCount, effectiveSlides(slides, imageCount));
    if (problem) problems.push({ path: ["slides"], message: problem });
  }
  values.captions.forEach((caption, i) => {
    if (caption.trim().length > POLAROID_MAX_CAPTION_CHARS) {
      problems.push({
        path: ["captions", i],
        message: `Captions can be up to ${POLAROID_MAX_CAPTION_CHARS} characters`,
      });
    }
  });
  return problems;
}

/** Builds the polaroid API request from form values and the uploaded object keys. */
export function buildPolaroidBody(
  values: PolaroidFormValues & { format: CollageFormat },
  keys: string[],
): CreateCollageBody {
  const captions = keys.map((_, i) => (values.captions[i] ?? "").trim());
  return CreateCollageBody.parse({
    images: keys,
    mode: "polaroid",
    polaroid: {
      ...(Number.isNaN(values.slides) ? {} : { slides: values.slides }),
      slideAspect: values.slideAspect,
      ...(captions.some((caption) => caption !== "") && { captions }),
    },
    format: values.format,
  });
}
```

Edit `src/features/collage/form.ts`:

1. Add imports:

```ts
import {
  POLAROID_FORM_DEFAULTS,
  buildPolaroidBody,
  polaroidProblems,
  type PolaroidFormValues,
} from "@/features/collage/polaroidForm";
import { PolaroidAspect } from "@/lib/schemas/polaroid";
```

2. Change `export interface CollageFormValues {` to `export interface CollageFormValues extends PolaroidFormValues {`.

3. In `COLLAGE_FORM_DEFAULTS`, add `...POLAROID_FORM_DEFAULTS,` as the first entry of the object (before `files: [],`).

4. In `createCollageFormSchema`, add to the `z.object({...})` after `format: CollageFormat,`:

```ts
      mode: z.enum(["grid", "polaroid"]),
      slides: size,
      slideAspect: PolaroidAspect,
      captions: z.array(z.string()),
```

and in its `.superRefine`, directly after the `v.files.forEach(...)` block, add:

```ts
      if (v.mode === "polaroid") {
        for (const problem of polaroidProblems(v, v.files.length)) {
          ctx.addIssue({ code: "custom", path: problem.path, message: problem.message });
        }
        return;
      }
```

5. At the top of `buildCreateBody` add:

```ts
  if (values.mode === "polaroid") return buildPolaroidBody(values, keys);
```

- [ ] **Step 4: Run and confirm the form tests pass, with grid regression**

Run: `npx vitest run tests/unit/polaroidForm.test.ts tests/unit/collageForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the components**

Edit `src/components/collage/CollageOptionsFields.tsx`:

1. Change `function Radio(` to `export function Radio(` and `function SectionHeading({` to `export function SectionHeading({`.
2. Replace the entire third `<section ...>` block (the one with `number="05"` and the `Output format` fieldset) with `<OutputFormatSection form={form} number="05" />`.
3. Add this component to the file:

```tsx
export function OutputFormatSection({
  form,
  number,
}: {
  form: UseFormReturn<CollageFormValues>;
  number: string;
}) {
  const { register } = form;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <SectionHeading
        number={number}
        title="Set your output"
        description="Choose the file type that works for you."
      />
      <fieldset>
        <legend className="sr-only">Output format</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Radio
            label="PNG"
            description="Crisp quality with transparency support."
            value="png"
            {...register("format")}
          />
          <Radio
            label="JPEG"
            description="Smaller file, great for sharing."
            value="jpeg"
            {...register("format")}
          />
        </div>
      </fieldset>
    </section>
  );
}
```

Create `src/components/collage/PolaroidOptionsFields.tsx`:

```tsx
"use client";

import type { UseFormReturn } from "react-hook-form";
import {
  OutputFormatSection,
  Radio,
  SectionHeading,
} from "@/components/collage/CollageOptionsFields";
import { fieldErrorClass, inputClass } from "@/components/collage/fieldStyles";
import type { CollageFormValues } from "@/features/collage/form";
import { SLIDE_ASPECT_OPTIONS, effectiveSlides } from "@/features/collage/polaroidForm";
import {
  POLAROID_MAX_CAPTION_CHARS,
  POLAROID_MAX_SLIDES,
  POLAROID_MIN_SLIDES,
} from "@/lib/planner/collage/polaroid/defaults";

type Form = UseFormReturn<CollageFormValues>;

export function ModeSwitch({ form }: { form: Form }) {
  const { register } = form;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <fieldset>
        <legend className="text-base font-semibold">What are you making?</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Radio
            label="Collage"
            description="One image with every photo arranged in a grid."
            value="grid"
            {...register("mode")}
          />
          <Radio
            label="Polaroid carousel"
            description="Polaroids on a torn diary page, sliced into swipeable slides."
            value="polaroid"
            {...register("mode")}
          />
        </div>
      </fieldset>
    </section>
  );
}

export function PolaroidOptionsFields({ form, files }: { form: Form; files: File[] }) {
  const { register, formState } = form;
  const errors = formState.errors;
  const auto = effectiveSlides(Number.NaN, files.length);

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="03"
          title="Shape your carousel"
          description="Choose how many slides to swipe through and their shape."
        />
        <label htmlFor="polaroid-slides" className="text-sm font-medium">
          Slides
        </label>
        <input
          id="polaroid-slides"
          type="number"
          inputMode="numeric"
          min={POLAROID_MIN_SLIDES}
          max={POLAROID_MAX_SLIDES}
          placeholder={`Auto (${auto})`}
          className={inputClass}
          aria-invalid={errors.slides ? true : undefined}
          aria-describedby="polaroid-slides-note polaroid-slides-error"
          {...register("slides", { valueAsNumber: true })}
        />
        <p id="polaroid-slides-note" className="mt-2 text-xs leading-5 text-muted-foreground">
          Leave it empty for about three photos per slide. Polaroids can cross slide edges, so
          swipe through the slides in order.
        </p>
        <p id="polaroid-slides-error" className={fieldErrorClass}>
          {errors.slides?.message}
        </p>
        <fieldset className="mt-5">
          <legend className="sr-only">Slide shape</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SLIDE_ASPECT_OPTIONS.map((option) => (
              <Radio
                key={option.id}
                label={option.label}
                description={option.size}
                value={option.id}
                {...register("slideAspect")}
              />
            ))}
          </div>
        </fieldset>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <SectionHeading
          number="04"
          title="Add captions"
          description="Optional handwriting on the bottom strip of each polaroid."
        />
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Choose your images to add captions.</p>
        ) : (
          <ul className="space-y-3">
            {files.map((file, i) => (
              <li key={`${i}-${file.name}`}>
                <label htmlFor={`polaroid-caption-${i}`} className="text-sm font-medium">
                  Caption for {file.name}
                </label>
                <input
                  id={`polaroid-caption-${i}`}
                  type="text"
                  autoComplete="off"
                  maxLength={POLAROID_MAX_CAPTION_CHARS}
                  className={inputClass}
                  aria-invalid={errors.captions?.[i] ? true : undefined}
                  {...register(`captions.${i}` as const)}
                />
                <p className={fieldErrorClass}>{errors.captions?.[i]?.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OutputFormatSection form={form} number="05" />
    </>
  );
}
```

Create `src/components/collage/PolaroidResult.tsx`:

```tsx
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { PolaroidJobResult } from "@/lib/schemas/api";

type Output = PolaroidJobResult["output"];

const primaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto";
const secondaryLink =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto";

export function PolaroidResult({ output }: { output: Output }) {
  const [index, setIndex] = useState(0);
  const { slides, slideCount, slideWidth, slideHeight, slideFormat, zipUrl } = output;
  const slide = slides[index];
  const go = (next: number) => setIndex(Math.min(slides.length - 1, Math.max(0, next)));

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    }
  }

  if (!slide) return null;
  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6"
      aria-labelledby="polaroid-result-heading"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Ready to take with you
        </p>
        <h2 id="polaroid-result-heading" className="mt-1 text-lg font-semibold">
          Your polaroid carousel
        </h2>
      </div>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label="Carousel preview"
        onKeyDown={onKeyDown}
        className="space-y-3"
      >
        {/* Signed, short-lived object-store URL: next/image would need a remote host allow-list. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.url}
          alt={`Slide ${index + 1} of ${slideCount}`}
          width={slideWidth}
          height={slideHeight}
          className="mx-auto h-auto max-h-[34rem] w-auto max-w-full rounded-xl border border-border bg-muted object-contain"
        />
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            aria-label="Previous slide"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
            Slide {index + 1} of {slideCount}
          </p>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            aria-label="Next slide"
            disabled={index === slides.length - 1}
            onClick={() => go(index + 1)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <a href={zipUrl} rel="noopener noreferrer" className={primaryLink}>
          Download all slides (ZIP)
        </a>
        <a href={slide.url} rel="noopener noreferrer" className={secondaryLink}>
          Open this slide
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        {slideCount} slides, {slideWidth}×{slideHeight} {slideFormat.toUpperCase()}. The links
        expire, so download them soon.
      </p>
    </section>
  );
}
```

Edit `src/components/collage/CollageStatus.tsx`:

1. Imports: change `import { CollageJobResult } from "@/lib/schemas/api";` to `import { CollageJobResult, PolaroidJobResult } from "@/lib/schemas/api";` and add:

```tsx
import { PolaroidResult } from "@/components/collage/PolaroidResult";
import { POLAROID_JOB_TYPE } from "@/lib/schemas/polaroid";
```

2. Replace the start of `CollageResult` (from `export function CollageResult` through the closing `}` of the `if (!parsed.success) {...}` block) with:

```tsx
function ResultUnreadable() {
  return (
    <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-destructive">
        The collage finished, but its result could not be read.
      </p>
    </div>
  );
}

export function CollageResult({ job }: { job: JobResponse }) {
  if (job.type === POLAROID_JOB_TYPE) {
    const polaroid = PolaroidJobResult.safeParse(job.result);
    return polaroid.success ? (
      <PolaroidResult output={polaroid.data.output} />
    ) : (
      <ResultUnreadable />
    );
  }
  const parsed = CollageJobResult.safeParse(job.result);
  if (!parsed.success) return <ResultUnreadable />;
```

The rest of `CollageResult` (from `const { downloadUrl, width, height, format } = parsed.data.output;`) is unchanged.

Edit `src/components/collage/CollageCreateForm.tsx`:

1. Add `import { ModeSwitch, PolaroidOptionsFields } from "@/components/collage/PolaroidOptionsFields";` with the other component imports.
2. After `const files = useWatch({ control: form.control, name: "files" });` add `const mode = useWatch({ control: form.control, name: "mode" });`.
3. In `onFilesChange`, after `form.setValue("files", selected, {...});` add `form.setValue("captions", selected.map(() => ""));` (captions are per file, so a new selection starts blank).
4. Replace the `<CollageOptionsFields ... />` element with:

```tsx
        <ModeSwitch form={form} />
        {mode === "polaroid" ? (
          <PolaroidOptionsFields form={form} files={files} />
        ) : (
          <CollageOptionsFields
            form={form}
            limits={limits}
            templates={templates}
            fileCount={files.length}
          />
        )}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx prettier --write src/features/collage/polaroidForm.ts src/features/collage/form.ts src/components/collage tests/unit/polaroidForm.test.ts`
Run: `npx tsc --noEmit` (expected: no errors) and `npx eslint src/features/collage src/components/collage tests/unit/polaroidForm.test.ts` (expected: clean; fix any `react-hooks` or unused-import findings in the files you touched).

- [ ] **Step 7: Write the e2e test, run it**

Create `tests/e2e/polaroid.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const PUT_URL = "http://minio.test/put";
const ZIP_URL = "https://minio.test/polaroid.zip";
const slideUrl = (n: number) => `https://minio.test/slide-0${n}.png`;

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#d22" } })
    .png()
    .toBuffer();
}

/** Mocks storage, presign, create and job polling; returns the captured create-collage bodies. */
async function mockRun(page: Page, png: Buffer): Promise<unknown[]> {
  for (const n of [1, 2]) {
    await page.route(slideUrl(n), (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: png }),
    );
  }
  await page.route(PUT_URL, (route) =>
    route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    }),
  );
  let uploads = 0;
  await page.route("**/api/uploads/presign", (route) => {
    uploads += 1;
    return route.fulfill({
      json: { url: PUT_URL, key: `uploads/owner/u${uploads}/a.png`, expiresInSec: 900 },
    });
  });
  const bodies: unknown[] = [];
  await page.route("**/api/collages", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { jobId: "j1" } });
  });
  await page.route("**/api/jobs/j1", (route) =>
    route.fulfill({
      json: {
        id: "j1",
        type: "collage.polaroid",
        status: "succeeded",
        progress: 100,
        result: {
          output: {
            slideCount: 2,
            slideWidth: 1080,
            slideHeight: 1080,
            slideFormat: "png",
            zipUrl: ZIP_URL,
            slides: [
              { index: 0, url: slideUrl(1) },
              { index: 1, url: slideUrl(2) },
            ],
            expiresInSec: 900,
          },
        },
        error: null,
      },
    }),
  );
  return bodies;
}

async function openPolaroidForm(page: Page, png: Buffer, count: number): Promise<void> {
  await page.goto("/collages");
  // A dev server with STUDIO_API_KEY pre-fills the key; these tests use their own key.
  const useOwnKey = page.getByRole("button", { name: "Use a different key" });
  if (await useOwnKey.isVisible()) await useOwnKey.click();
  await page.getByLabel("API key").fill("ak_test");
  await page.getByLabel("Images").setInputFiles(
    Array.from({ length: count }, (_, i) => ({
      name: `img-${i}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await page.getByLabel("Polaroid carousel").check();
}

test("creates a polaroid carousel with captions and previews its slides", async ({ page }) => {
  const png = await makePng();
  const bodies = await mockRun(page, png);
  await openPolaroidForm(page, png, 4);

  await expect(page.getByRole("heading", { name: "Shape your carousel" })).toBeVisible();
  await expect(page.getByLabel("Slides", { exact: true })).toHaveAttribute(
    "placeholder",
    "Auto (2)",
  );
  await page.getByLabel("Square 1:1").check();
  await page.getByLabel("Caption for img-0.png").fill("Summer 2025");
  await page.getByRole("button", { name: "Create collage" }).click();

  await expect(page.getByRole("img", { name: "Slide 1 of 2" })).toBeVisible();
  expect(bodies[0]).toMatchObject({
    mode: "polaroid",
    format: "png",
    polaroid: { slideAspect: "1:1", captions: ["Summer 2025", "", "", ""] },
  });
  expect(bodies[0]).not.toHaveProperty("canvas");

  await expect(page.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(page.getByRole("img", { name: "Slide 2 of 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download all slides (ZIP)" })).toHaveAttribute(
    "href",
    ZIP_URL,
  );
});

test("blocks a carousel with fewer images than slides", async ({ page }) => {
  const png = await makePng();
  const bodies = await mockRun(page, png);
  await openPolaroidForm(page, png, 3);

  await page.getByLabel("Slides", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Create collage" }).click();

  await expect(page.getByText("4 slides need at least 4 images")).toBeVisible();
  expect(bodies).toHaveLength(0);
});
```

Run: `npx playwright test tests/e2e/polaroid.spec.ts tests/e2e/collage.spec.ts`
Expected: PASS for both files (the grid specs prove the default mode is untouched). If Playwright browsers are missing, run `npx playwright install chromium` first.

- [ ] **Step 8: Commit**

Run `npx prettier --check tests/e2e/polaroid.spec.ts` (fix with `--write` if needed).

```powershell
git add src/features/collage/polaroidForm.ts src/components/collage/PolaroidOptionsFields.tsx src/components/collage/PolaroidResult.tsx tests/unit/polaroidForm.test.ts tests/e2e/polaroid.spec.ts
git commit -m "feat: add polaroid carousel create form and preview" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

(`form.ts`, `CollageOptionsFields.tsx`, `CollageCreateForm.tsx` and `CollageStatus.tsx` are pre-modified and stay uncommitted by design.)

---

### Task 7: API docs

**Files:**
- Modify (pre-modified, do not stage): `docs/api.md`

- [ ] **Step 1: Document the request**

In `docs/api.md`, directly before the line `Limits (server configuration, defaults shown):` add:

````md
### Polaroid carousel (`mode: "polaroid"`)

Builds one seamless spread (a torn sheet of paper glued onto a diary page) with the images as
polaroid-style prints, then slices it into carousel slides. Polaroids can cross slide edges, so the
slides are meant to be swiped through in order. `canvas`, `style`, and `template` are not accepted
for this mode.

```json
{
  "images": ["<key 1>", "<key 2>", "<key 3>", "<key 4>"],
  "mode": "polaroid",
  "polaroid": {
    "slides": 2,
    "slideAspect": "4:5",
    "captions": ["Summer 2025", "", "Road trip", "Home"]
  },
  "format": "png",
  "webhookUrl": "https://example.com/hooks/collage"
}
```

- `slideAspect` (required): `4:5` (1080×1350 px slides) or `1:1` (1080×1080 px slides).
- `slides` (optional): 2 to 10. Defaults to about three images per slide (`ceil(images / 3)`, kept
  between 2 and 10). There must be at least one image per slide and at most six per slide.
- `captions` (optional): exactly one entry per image, up to 60 characters each, plain text. An empty
  string leaves that polaroid's caption strip blank. Captions are written in a handwriting font.
- `format` (`png` or `jpeg`, default `png`) applies to the slides. Placement is automatic and
  deterministic for the same ordered images.

The response is the same `202` with a `jobId` (the job `type` is `collage.polaroid`).

````

- [ ] **Step 2: Document limits, the result and webhooks**

1. In the limits table, add after the `Decoded pixels per input image` row:
   `| Polaroid spread area | 20 megapixels | \`COLLAGE_POLAROID_MAX_SPREAD_PIXELS\` | On create (\`400\`) |`
   and, in the paragraph after the table, add: `Polaroid captions use the font at \`POLAROID_FONT_PATH\` (default \`assets/fonts/Caveat-Regular.ttf\`, SIL OFL); the worker image must contain it.`
2. In `GET /api/jobs/:id`, after the `Expiry:` paragraph add:

````md
A succeeded polaroid job (`type` is `collage.polaroid`) returns one ZIP of all slides plus a URL per
slide for previewing:

```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "type": "collage.polaroid",
  "status": "succeeded",
  "progress": 100,
  "result": {
    "output": {
      "slideCount": 2,
      "slideWidth": 1080,
      "slideHeight": 1350,
      "slideFormat": "png",
      "zipUrl": "<short-lived signed GET URL>",
      "slides": [
        { "index": 0, "url": "<short-lived signed GET URL>" },
        { "index": 1, "url": "<short-lived signed GET URL>" }
      ],
      "expiresInSec": 900
    }
  },
  "error": null
}
```

All URLs are signed fresh on every poll and expire after `expiresInSec`; the result is `null` until the job succeeds.
````

3. In the Webhooks section, extend the `resultUrls` sentence: after "`resultUrls` contains the output download URL only for a succeeded collage job;" add " for a polaroid job it lists the ZIP URL first, then one URL per slide in order;".

- [ ] **Step 3: Format**

Run: `npx prettier --write docs/api.md` then `git diff --stat docs/api.md` (the file is pre-modified, so it stays uncommitted).

---

### Task 8: Full verification and cleanup

- [ ] **Step 1: Run the whole suite**

Run: `npx tsc --noEmit` (expected: no errors).
Run: `npm run lint` (expected: no new findings; if lint reports pre-existing problems in files you did not touch, record them and move on).
Run: `npm test` (expected: all Vitest files pass, including the new polaroid files and every existing grid test).
Run: `npx prettier --check` on every file this plan created or edited (list them with `git status --short`; ignore the user's unrelated modified files).
Run: `npm run e2e` (expected: all Playwright specs pass).

- [ ] **Step 2: Visual smoke check of the renderer (not committed)**

Render 3 slides of 4:5 with 8 captioned inputs through `planPolaroidCarousel` + `renderPolaroidSlides` (for example with a throwaway `tsx` script in the session folder, not the repo), open the slides and confirm: cream ruled page with binding holes along the top, a torn glued sheet with a soft shadow, tilted white-frame polaroids with tape and handwritten captions, and polaroids that continue across the slide seams.

- [ ] **Step 3: Check the tree**

Run: `git status --short` and confirm there are no stray files (nothing under `.scratch/`, no temp output) beyond the intended changes.

- [ ] **Step 4: Report**

State: what was committed (list the task commits from `git log --oneline -8`), that the user's pre-existing edits plus this feature's edits to `api.ts`, `config.ts`, `.env.example`, `route.ts`, `form.ts`, `CollageOptionsFields.tsx`, `CollageCreateForm.tsx`, `CollageStatus.tsx` and `docs/api.md` are intentionally left uncommitted for review, and that the worker image must include `assets/fonts/Caveat-Regular.ttf` (no Dockerfile exists in this repo yet). Note that no live Postgres/Redis/MinIO end-to-end run was possible unless `npm run smoke` was run against real services.

