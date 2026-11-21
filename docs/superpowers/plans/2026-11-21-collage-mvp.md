# Collage MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an asynchronous, crop-aware grid collage flow with a browser uploader, API, worker, and short-lived result downloads.

**Architecture:** The browser uploads images directly to MinIO through the existing presign flow, then submits owner-scoped object keys to a thin `withApi` route. A BullMQ worker analyzes, plans, and renders using separate analyzer/planner/renderer modules, stores an output asset, and persists only its asset ID and metadata in the job result; API polling and completion webhooks generate fresh short-lived result URLs.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod, Drizzle/Postgres, BullMQ/Redis, MinIO S3 SDK, sharp, React, TanStack Query, React Hook Form/Zod resolver, Vitest, fast-check, Playwright, Tailwind, shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-11-21-collage-mvp-design.md](../specs/2026-11-21-collage-mvp-design.md)

## Global Constraints

- Accept 1–20 images per job; the default maximum is 20 and is configurable.
- Limit each image upload to 200 MB and decoded input to 200 megapixels; both limits are configurable.
- Limit output canvases to 40 megapixels and 8192 px on either side.
- Default to justified rows; exact-count templates are 2×2 for 4 images, 3×3 for 9, hero+4 for 5, and rectangular grids for 1–20.
- Default to PNG; support JPEG as an option. Default background is `#ffffff`; default gap is 12 px.
- Keep the API key only in browser component memory; never persist or log it.
- Return only `jobId` from collage creation; do not add a collage table or expose output asset IDs/keys.
- Persist asset IDs and metadata, not signed URLs. Generate fresh signed URLs in job polling and webhook delivery.
- Keep planner code pure, deterministic, and browser-safe. The renderer executes a validated `LayoutSpec` and makes no layout decisions.
- Keep long-running work in the worker; use `withApi` and Zod at route boundaries.
- Do not import `server-only` from modules imported by the plain Node/tsx worker; reserve it for route-only modules.
- Use strict types and Zod at boundaries; do not introduce `any`.
- Clean per-job temporary directories in `finally`; keep image rendering sequential within a job and collage concurrency at 1 by default.
- HEIC is accepted only if the packaged sharp/libvips build passes a decode fixture; otherwise exclude it from collage validation and presigning.
- Do not add sequence layouts, color-adjacency optimization, face/saliency analysis, editor/pinning, reverse detection, or session authentication.
- Every implementation task uses TDD and ends with its focused tests passing. Each commit includes `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

## File Structure

### New modules

| File | Responsibility |
|---|---|
| `src/lib/schemas/collage.ts` | Shared Zod types for worker input and internal output result |
| `src/server/db/repositories/assets.ts` | Owner-scoped, idempotent source/output asset registration and lookup |
| `src/server/storage/objects.ts` | Bounded object metadata, download-to-file, and file-upload helpers |
| `src/lib/planner/collage/grid/types.ts` | Pure canvas, image-stat, slot, and template types |
| `src/lib/planner/collage/grid/justifiedRows.ts` | Deterministic justified row/slot generation |
| `src/lib/planner/collage/grid/templates.ts` | Curated and rectangular exact-count slot generation |
| `src/lib/planner/collage/hungarian.ts` | Pure rectangular Hungarian assignment solver |
| `src/lib/planner/collage/assign.ts` | Crop/resolution cost matrix and image-to-slot assignment |
| `src/lib/planner/collage/plan.ts` | Validated `LayoutSpec` creation for the public grid styles |
| `src/server/analyzers/image/metadata.ts` | Sharp metadata probe, EXIF-oriented dimensions, and pixel-limit checks |
| `src/server/renderers/collage.ts` | Sharp-only execution of a validated layout |
| `src/app/api/collages/route.ts` | Authenticated collage create/validate/enqueue route |
| `worker/processors/buildCollage.ts` | Idempotent collage job processor |
| `src/components/providers/QueryProvider.tsx` | Client TanStack Query provider |
| `src/components/collage/CollageCreateForm.tsx` | API-key, file, layout, canvas, and format form |
| `src/features/collage/useUpload.ts` | Presign and direct-upload progress flow |
| `src/features/collage/useJob.ts` | Authenticated job polling |
| `src/app/collages/page.tsx` | Collage create and result page |
| `tests/unit/collage*.test.ts` | Focused collage schema, planner, assignment, analyzer, and renderer tests |
| `tests/property/collageLayouts.test.ts` | Layout and assignment properties |
| `tests/integration/collages.test.ts` | Route/job/result behavior with mocked infrastructure |
| `tests/e2e/collage.spec.ts` | Browser upload-to-download smoke test |
| `playwright.config.ts` | Playwright configuration |

### Existing modules to modify

- `package.json` and `package-lock.json`: sharp and browser-form/query dependencies.
- `src/server/config.ts` and `.env.example`: collage limits and concurrency.
- `src/lib/schemas/api.ts`: create request, create response, and public job result schemas.
- `src/app/api/uploads/presign/route.ts`: image-specific upload byte cap.
- `src/app/api/jobs/[id]/route.ts`: owner-scoped fresh signed result URL.
- `worker/index.ts`: register `buildCollage` for the `collage` queue.
- `worker/runJob.ts`: add result URL generation for successful collage webhooks.
- `tests/unit/config.test.ts`, `tests/unit/schemas.test.ts`, `tests/integration/routes.test.ts`: extend existing coverage.
- `src/app/layout.tsx` and `src/app/page.tsx`: query provider and collage navigation.
- `docs/api.md`: document collage creation and polling result.

The existing `assets` table already supports `image` and `output` records; no collage table or
database migration is planned.

## Task 1: Add Collage Limits and Sharp

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/server/config.ts`
- Modify: `.env.example`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- `getConfig()` adds `maxImageUploadBytes`, `collageMaxImages`, `collageMaxInputPixels`,
  `collageMaxCanvasPixels`, `collageMaxDimension`, and `workerConcurrencyCollage`.
- Defaults are 200 MB, 20 images, 200,000,000 input pixels, 40,000,000 canvas pixels, 8192 px,
  and concurrency 1.

- [ ] **Step 1: Write a failing config test**

Add a test using the existing valid environment fixture:

```ts
it("loads bounded collage defaults", () => {
  const config = loadConfig(valid);
  expect(config).toMatchObject({
    maxImageUploadBytes: 200 * 1024 * 1024,
    collageMaxImages: 20,
    collageMaxInputPixels: 200_000_000,
    collageMaxCanvasPixels: 40_000_000,
    collageMaxDimension: 8192,
    workerConcurrencyCollage: 1,
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing fields fail**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL because the parsed config does not contain the collage settings.

- [ ] **Step 3: Add config parsing and the sharp dependency**

Add positive integer environment settings `MAX_IMAGE_UPLOAD_MB`, `COLLAGE_MAX_IMAGES`,
`COLLAGE_MAX_INPUT_PIXELS`, `COLLAGE_MAX_CANVAS_PIXELS`, `COLLAGE_MAX_DIMENSION`, and
`WORKER_CONCURRENCY_COLLAGE`, with the defaults above. Convert MB to bytes in `loadConfig`, add
matching entries to `.env.example`, then run `npm install sharp`.

- [ ] **Step 4: Verify config and type safety**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json src/server/config.ts .env.example tests/unit/config.test.ts
git commit -m "feat: configure collage processing limits" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Define Collage Contracts

**Files:**
- Create: `src/lib/schemas/collage.ts`
- Modify: `src/lib/schemas/api.ts`
- Test: `tests/unit/schemas.test.ts`

**Interfaces:**
- `CollageTemplateId` is `"grid-2x2" | "grid-3x3" | "hero-4" | "rectangular"`.
- `CreateCollageBody` accepts `images`, `mode: "grid"`, `style`, optional `template`, `canvas`,
  `format`, and optional `webhookUrl`.
- `CreateCollageResponse` is `{ jobId: string }`.
- `CollageWorkerInput` is `{ sourceAssetIds: string[]; style: "justified" | "template"; template?: CollageTemplateId; canvas: { w: number; h: number; gap: number; bg: string }; format: "png" | "jpeg" }`.
- `CollageWorkerResult` is internal `{ outputAssetId: string; width: number; height: number; format: "png" | "jpeg" }`.
- `CollageJobResult` is public `{ output: { width: number; height: number; format: "png" | "jpeg"; downloadUrl: string; expiresInSec: number } }`.

- [ ] **Step 1: Add schema regression tests**

Test that:
- A one-image justified PNG request parses and defaults to 12 px/white.
- `CollageWorkerInput` accepts a nonempty source asset-ID list and rejects duplicates.
- Duplicate image keys are rejected.
- `grid-2x2`, `grid-3x3`, and `hero-4` reject image counts other than 4, 9, and 5.
- `style: "template"` requires a template ID, while `style: "justified"` rejects one.
- Custom canvas dimensions must be positive integers, background must match `#RRGGBB`, and format is PNG or JPEG.
- The public result rejects invalid URL/format/dimensions.

Use a representative valid request:

```ts
const valid = {
  images: ["uploads/owner/u1/a.png"],
  mode: "grid",
  style: "justified",
  canvas: { w: 1080, h: 1080 },
};
expect(CreateCollageBody.parse(valid)).toMatchObject({
  style: "justified",
  format: "png",
  canvas: { gap: 12, bg: "#ffffff" },
});
expect(CreateCollageBody.safeParse({ ...valid, images: [...valid.images, ...valid.images] }).success)
  .toBe(false);
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run: `npx vitest run tests/unit/schemas.test.ts`
Expected: FAIL because the collage schemas do not exist.

- [ ] **Step 3: Implement shared schemas**

Keep request/response schemas in `api.ts`; place `CollageWorkerInput`,
`CollageWorkerResult`, and other worker-only contracts in `collage.ts`. Use `.superRefine` for
duplicate keys, style/template consistency, and curated template counts. The configured maximum
image count remains a route-level check.

- [ ] **Step 4: Verify schema tests**

Run: `npx vitest run tests/unit/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/schemas/api.ts src/lib/schemas/collage.ts tests/unit/schemas.test.ts
git commit -m "feat: define collage API contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Add Owner-Scoped Assets and Bounded Object I/O

**Files:**
- Create: `src/server/db/repositories/assets.ts`
- Create: `src/server/storage/objects.ts`
- Modify: `src/app/api/uploads/presign/route.ts`
- Test: `tests/unit/assets.test.ts`
- Test: `tests/integration/routes.test.ts`

**Interfaces:**
- `assetsRepo.register(args: { ownerId: string; key: string; kind: "image" | "output"; contentType: string; sizeBytes: number; metadata?: Record<string, unknown> }): Promise<AssetRow>`
- `assetsRepo.getForOwner(id: string, ownerId: string): Promise<AssetRow | undefined>`
- `assetsRepo.getByKeyForOwner(key: string, ownerId: string): Promise<AssetRow | undefined>`
- `headObject(key: string): Promise<{ contentType?: string; sizeBytes?: number }>`
- `downloadObjectToFile(key: string, path: string, maxBytes: number): Promise<void>`
- `uploadFile(key: string, path: string, contentType: string): Promise<number>` returns uploaded byte count.

- [ ] **Step 1: Test same-owner registration and cross-owner isolation**

Add repository tests that register an image twice for one owner and receive the same row, then
attempt to resolve the same key for another owner and receive `undefined`. Mock Drizzle using the
existing Vitest module-mock pattern; do not make real database calls in unit tests.

The behavior assertions are:

```ts
const first = await assetsRepo.register(input);
await expect(assetsRepo.register(input)).resolves.toEqual(first);
await expect(assetsRepo.getByKeyForOwner(input.key, "another-owner")).resolves.toBeUndefined();
```

- [ ] **Step 2: Test bounded object metadata and download**

Mock `HeadObjectCommand` to return content type and size. Verify an object larger than `maxBytes`
rejects with `PAYLOAD_TOO_LARGE` and leaves no partial destination file.

- [ ] **Step 3: Test the image-specific presign limit**

Extend `tests/integration/routes.test.ts` so an image larger than `MAX_IMAGE_UPLOAD_MB` returns
413 while a valid image under the image cap succeeds. Retain the existing video cap behavior.

- [ ] **Step 4: Run the tests and verify the expected failures**

Run: `npx vitest run tests/unit/assets.test.ts tests/integration/routes.test.ts`
Expected: FAIL because the repository and image cap do not exist.

- [ ] **Step 5: Implement the asset repository**

Use the existing `assets` table. Make `register` safe for concurrent duplicate keys with
`onConflictDoNothing` followed by an owner-scoped lookup; throw `CONFLICT` if the unique key belongs
to another owner. Return an existing asset only if its owner, kind, content type, and size match.

- [ ] **Step 6: Implement bounded S3 object helpers**

Use S3 `HeadObjectCommand`, `GetObjectCommand`, and `PutObjectCommand`. Download with `pipeline`
and a byte counter that aborts when `maxBytes` is exceeded; on failure, remove the partial
destination file. Do not buffer whole source files in memory. Upload from a file stream and return
the resulting byte count for asset metadata.

- [ ] **Step 7: Enforce image limit at presign**

In the existing presign route, use `maxImageUploadBytes` for `image/*` and `maxUploadBytes` for
video MIME types. Return the existing 413 envelope and keep object keys owner-namespaced.

- [ ] **Step 8: Verify storage and route tests**

Run: `npx vitest run tests/unit/assets.test.ts tests/integration/routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/server/db/repositories/assets.ts src/server/storage/objects.ts src/app/api/uploads/presign/route.ts tests/unit/assets.test.ts tests/integration/routes.test.ts
git commit -m "feat: add collage asset handling" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Generate Justified and Template Slots

**Files:**
- Create: `src/lib/planner/collage/grid/types.ts`
- Create: `src/lib/planner/collage/grid/justifiedRows.ts`
- Create: `src/lib/planner/collage/grid/templates.ts`
- Create: `src/lib/planner/collage/plan.ts`
- Test: `tests/unit/collageSlots.test.ts`
- Test: `tests/property/collageLayouts.test.ts`

**Interfaces:**
- `CanvasSize = { w: number; h: number }`.
- `CanvasSpec = { w: number; h: number; gap: number; bg: string }`.
- `ImageStats = { assetId: string; widthPx: number; heightPx: number; pixelCount: number }`.
- `Slot = { id: number; x: number; y: number; w: number; h: number; order: number; hero: boolean }`.
- `GridPlanInput = { canvas: CanvasSpec; images: readonly ImageStats[]; style: "justified" | "template"; template?: CollageTemplateId }`.
- `generateJustifiedSlots(canvas: CanvasSize, images: readonly ImageStats[], gapPx: number): Slot[]`.
- `generateTemplateSlots(canvas: CanvasSize, imageCount: number, template: CollageTemplateId, gapPx: number): Slot[]`.
- `planGridCollage(input: GridPlanInput): LayoutSpec`.

- [ ] **Step 1: Write slot and property tests**

Cover 1–20 images, portrait/square/landscape canvases, gaps 0 and 12, each curated template count,
and rectangular fallback counts. Assert each result stays inside the canvas, no cells overlap, IDs
are unique, exactly one slot exists per image, and justified rows fill the usable row width within
one pixel.

The property test should construct a layout for generated valid image dimensions and assert the
shared invariants:

```ts
fc.assert(
  fc.property(
    fc.array(
      fc.record({
        widthPx: fc.integer({ min: 1, max: 6000 }),
        heightPx: fc.integer({ min: 1, max: 6000 }),
      }),
      { minLength: 1, maxLength: 20 },
    ),
    (dimensions) => {
      const images = dimensions.map(({ widthPx, heightPx }, i) => ({
        assetId: `a${i}`,
        widthPx,
        heightPx,
        pixelCount: widthPx * heightPx,
      }));
      const layout = planGridCollage({
        canvas: { w: 1080, h: 1350, gap: 12, bg: "#ffffff" },
        images,
        style: "justified",
      });
      expect(LayoutSpec.safeParse(layout).success).toBe(true);
      expect(layout.cells).toHaveLength(images.length);
      expect(new Set(layout.cells.map((cell) => cell.id)).size).toBe(images.length);
    },
  ),
);
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npx vitest run tests/unit/collageSlots.test.ts tests/property/collageLayouts.test.ts`
Expected: FAIL because the planner modules do not exist.

- [ ] **Step 3: Implement deterministic slot generation**

Special-case one image to occupy the entire canvas. Otherwise use
`rowCount = clamp(round(sqrt(imageCount / canvasAspect)), 1, imageCount)`. Partition upload order
into contiguous rows as evenly as possible, giving remainder cells to earlier rows. For justified
rows, split the canvas height after row gaps evenly across rows, giving any remainder pixels to
earlier rows. For justified rows, reserve one pixel per cell, apportion the remaining usable row
width by each seed image aspect ratio, and distribute rounding remainder left-to-right. For
rectangular, divide each row evenly. Reject impossible dimensions when gaps leave insufficient
pixels for positive cells. Build exact 2×2 and 3×3 equal-cell geometries. For `hero-4`, give the
hero half of the usable canvas width on landscape or half of the usable height on portrait/square,
with four equal cells in a 2×2 group in the remaining region. Honor gaps in every template and
distribute integer-rounding remainders to earlier cells without creating zero-size cells.

- [ ] **Step 4: Build validated LayoutSpec**

Have `planGridCollage` set `mode: "grid"`, the selected style, canvas settings, unique cells, and
null image placeholders; parse its result with `LayoutSpec` before returning.

- [ ] **Step 5: Verify planner tests**

Run: `npx vitest run tests/unit/collageSlots.test.ts tests/property/collageLayouts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/planner/collage/grid/types.ts src/lib/planner/collage/grid/justifiedRows.ts src/lib/planner/collage/grid/templates.ts src/lib/planner/collage/plan.ts tests/unit/collageSlots.test.ts tests/property/collageLayouts.test.ts
git commit -m "feat: generate collage grid layouts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Add Hungarian Assignment and Crop Costs

**Files:**
- Create: `src/lib/planner/collage/hungarian.ts`
- Create: `src/lib/planner/collage/assign.ts`
- Modify: `src/lib/planner/collage/plan.ts`
- Test: `tests/unit/collageAssignment.test.ts`
- Test: `tests/property/collageLayouts.test.ts`

**Interfaces:**
- `solveAssignment(costs: readonly (readonly number[])[]): Array<{ row: number; column: number; cost: number }>` ordered by row.
- `assignImagesToSlots(images: readonly ImageStats[], slots: readonly Slot[]): Cell[]`
- `planGridCollage` returns cells with every input `assetId` assigned exactly once.

- [ ] **Step 1: Write solver and assignment tests**

Test square and rectangular matrices, empty matrices, deterministic ties, minimum-cost assignment
against a hand-calculated matrix, crop mismatch costs, hero resolution preference, and no duplicate
or missing image IDs.

Use a hand-computable cost matrix to check the solver's actual minimum:

```ts
expect(solveAssignment([[4, 1], [2, 3]]).map(({ row, column }) => [row, column])).toEqual([
  [0, 1],
  [1, 0],
]);
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npx vitest run tests/unit/collageAssignment.test.ts tests/property/collageLayouts.test.ts`
Expected: FAIL because the solver and assignment functions do not exist.

- [ ] **Step 3: Implement the pure rectangular solver**

Pad rectangular matrices with zero-cost dummy rows/columns internally, solve deterministically,
and return only assignments whose row and column refer to real inputs. Reject ragged or non-finite
cost matrices with a clear error.

- [ ] **Step 4: Implement assignment costs**

For each image/slot pair, calculate normalized `abs(log(imageAspect / slotAspect))` and the
predicted fraction cropped by cover scaling. Add a hero penalty that favors higher pixel count for
the hero slot. Keep weights in a `defaults.ts` beside the planner; do not add color adjacency.
Use original input order as the stable tie-break.

Extend `tests/property/collageLayouts.test.ts` to assert deterministic output for identical input
and that each input asset ID appears exactly once after assignment.

- [ ] **Step 5: Integrate assignment into `planGridCollage`**

Call the solver after slot generation and populate each cell's `image` and `order`. Ensure the final
spec still passes `LayoutSpec`.

- [ ] **Step 6: Verify assignment tests**

Run: `npx vitest run tests/unit/collageAssignment.test.ts tests/property/collageLayouts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/planner/collage/hungarian.ts src/lib/planner/collage/assign.ts src/lib/planner/collage/plan.ts tests/unit/collageAssignment.test.ts tests/property/collageLayouts.test.ts
git commit -m "feat: assign images to collage cells" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Inspect and Render Images with Sharp

**Files:**
- Create: `src/server/analyzers/image/metadata.ts`
- Create: `src/server/renderers/collage.ts`
- Modify: `src/app/api/uploads/presign/route.ts`
- Test: `tests/unit/collageImage.test.ts`
- Test: `tests/unit/collageRenderer.test.ts`
- Modify: `tests/integration/routes.test.ts`

**Interfaces:**
- `inspectImage(path: string, assetId: string, maxPixels: number): Promise<ImageStats>`.
- `isSupportedImageMime(contentType: string): boolean`.
- `renderCollage(args: { layout: LayoutSpec; sourcePaths: ReadonlyMap<string, string>; outputPath: string; format: "png" | "jpeg" }): Promise<void>`.

- [ ] **Step 1: Write tiny-image analyzer tests**

Generate 2×3 and 3×2 PNG fixtures in test setup with sharp. Add an EXIF orientation fixture or a
small test-generated JPEG carrying orientation 6. Assert returned dimensions are orientation-aware,
pixel count is correct, malformed input rejects, and an image over `maxPixels` is rejected before
render. When the installed sharp build can both encode and decode HEIC, generate a tiny HEIC fixture
and verify it decodes; otherwise verify HEIC is not reported as supported. Add a presign route test
that accepts HEIC only when `isSupportedImageMime("image/heic")` is true.

- [ ] **Step 2: Write renderer output tests**

Render a two-cell `LayoutSpec` from differently colored 2×2 images. Assert output format and exact
canvas dimensions with `sharp(outputPath).metadata()`, then sample pixels from both cells and the
white gap. Add a JPEG flattening test.

- [ ] **Step 3: Run analyzer and renderer tests and verify they fail**

Run: `npx vitest run tests/unit/collageImage.test.ts tests/unit/collageRenderer.test.ts tests/integration/routes.test.ts`
Expected: FAIL because analyzer and renderer modules do not exist.

- [ ] **Step 4: Implement metadata inspection**

Use `sharp(path, { limitInputPixels: maxPixels }).metadata()`, then call `.stats()` on the same
input with the pixel limit to force a full decode. Reject missing dimensions, unsupported formats,
decoded pixel counts above the configured limit, and malformed files with sanitized `AppError`s.
Swap width/height for EXIF orientations 5–8. Enable HEIC only when the installed build
reports both HEIF input and output and the generated decode fixture succeeds. Update the
presign route to reject HEIC when this capability check is false; the browser form's default picker
accepts JPEG, PNG, and WebP.

- [ ] **Step 5: Implement deterministic layout rendering**

Validate `layout` with `LayoutSpec.parse`. For each populated cell, use
`sharp(sourcePath).rotate().resize({ width: cell.w, height: cell.h, fit: "cover", position: "centre" })`.
Composite cells onto a `sharp({ create: { width, height, channels: 3, background } })` canvas at
their planned x/y coordinates. Encode PNG or flattened JPEG. Do not select or alter slots in the
renderer.

- [ ] **Step 6: Verify image tests**

Run: `npx vitest run tests/unit/collageImage.test.ts tests/unit/collageRenderer.test.ts tests/integration/routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/server/analyzers/image/metadata.ts src/server/renderers/collage.ts src/app/api/uploads/presign/route.ts tests/unit/collageImage.test.ts tests/unit/collageRenderer.test.ts tests/integration/routes.test.ts
git commit -m "feat: inspect and render collage images" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Create Collage Jobs Through the API

**Files:**
- Create: `src/app/api/collages/route.ts`
- Modify: `tests/integration/routes.test.ts`
- Modify: `docs/api.md`

**Interfaces:**
- `POST /api/collages` accepts `CreateCollageBody` and returns `202 CreateCollageResponse`.
- It registers verified inputs, then calls `enqueueJob({ queue: "collage", type: "collage.build", ownerId, input, webhookUrl })`.

Before writing route tests or implementation, read the Next.js 16 route-handler guide under
`node_modules/next/dist/docs/`, then compare the async request/params conventions with
`src/app/api/uploads/presign/route.ts` and `src/app/api/jobs/[id]/route.ts`.

- [ ] **Step 1: Write route tests**

Add integration cases for missing authentication, duplicate keys, foreign-owner keys, missing S3
objects, unsupported MIME/extension, object size over the image limit, image count over the
configured maximum, canvas over area/side limits, invalid curated template counts, and a valid
one-image and multi-image request. Assert invalid
requests do not create or enqueue a job and valid requests return 202 with only `jobId`.

The successful request assertion must also verify the queue input:

```ts
const response = await postCollage(validBody, ownerAuth);
expect(response.status).toBe(202);
expect(await response.json()).toEqual({ jobId: "job-1" });
expect(enqueueJob).toHaveBeenCalledWith(
  expect.objectContaining({ queue: "collage", type: "collage.build", ownerId: "owner-1" }),
);
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `npx vitest run tests/integration/routes.test.ts`
Expected: FAIL because `POST /api/collages` does not exist.

- [ ] **Step 3: Implement the thin route**

Use `withApi({ auth: "apiKey", body: CreateCollageBody }, ...)`. Check each key starts with
`uploads/${principal.id}/`, then call `headObject`. Validate supported image content type via `isSupportedImageMime`, extension, present positive actual
size, configured image count, canvas limits, and template/image count before registering assets.
Store the registered IDs and validated options in a `CollageWorkerInput` object in `jobs.input`; do
not store uploaded bytes or URLs. Call `enqueueJob` only after all checks pass and return
`{ status: 202, json: { jobId: job.id } }`.

- [ ] **Step 4: Document request and response**

Add justified and template examples to `docs/api.md`, document the exact template counts and
limits, and explain polling through `GET /api/jobs/:id`.

- [ ] **Step 5: Verify API tests and types**

Run: `npx vitest run tests/integration/routes.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/collages/route.ts tests/integration/routes.test.ts docs/api.md
git commit -m "feat: add collage creation API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 8: Process Jobs and Deliver Fresh Output URLs

**Files:**
- Create: `worker/processors/buildCollage.ts`
- Modify: `worker/index.ts`
- Modify: `worker/runJob.ts`
- Modify: `src/app/api/jobs/[id]/route.ts`
- Test: `tests/unit/buildCollage.test.ts`
- Test: `tests/unit/runJob.test.ts`
- Test: `tests/integration/collages.test.ts`

**Interfaces:**
- `createBuildCollageProcessor(deps?: BuildCollageDeps): (job: Job<JobData>) => Promise<void>`.
- `BuildCollageDeps` injects `assetsRepo.getForOwner` and `assetsRepo.register`,
  `downloadObjectToFile` and `uploadFile`, `inspectImage`, `planGridCollage`, `renderCollage`,
  `mkdtemp`, `rm`, `runJob`, and `RunJobDeps`. Its optional overrides use the exact argument and
  return types of those functions; production defaults use the existing modules.
- Parse persisted `jobs.input` with `CollageWorkerInput`; internal job result uses
  `CollageWorkerResult`; public job response uses `CollageJobResult`.

- [ ] **Step 1: Write processor tests**

Using a fake job store and object adapter, test queued→running→succeeded, progress updates,
one-image output, deterministic output key reuse on retry, cleanup after success and failure,
invalid media becoming a safe failed job, and no output asset on failure. Inject a `RunJobDeps`
fake to verify the processor delegates state transitions and progress to the existing `runJob`.

At minimum, assert the processor persists an asset reference rather than a signed URL:

```ts
await processor(fakeBullJob);
expect(fakeStore.result).toMatchObject({ outputAssetId: "output-1", format: "png" });
expect(JSON.stringify(fakeStore.result)).not.toContain("https://");
```

- [ ] **Step 2: Write result URL tests**

Test `GET /api/jobs/:id` returns 404 for another owner, omits result before success, owner-checks
the output asset after success, and generates a new presigned URL on each poll. Test successful
webhook delivery contains that URL in `resultUrls`, while failed jobs contain none.

- [ ] **Step 3: Run tests and verify they fail**

Run: `npx vitest run tests/unit/buildCollage.test.ts tests/unit/runJob.test.ts tests/integration/collages.test.ts`
Expected: FAIL because the collage processor and signed result handling do not exist.

- [ ] **Step 4: Implement the worker processor**

Parse persisted job input with `CollageWorkerInput`, then read source asset IDs and options. Create
a per-job temp directory
using `fs.mkdtemp`; resolve every source with `assetsRepo.getForOwner(assetId, job.ownerId)` and
reject missing or non-image assets; bounded-download each key using `maxImageUploadBytes`; call
`inspectImage`, `planGridCollage`, and `renderCollage`; upload
`outputs/${jobId}/collage.${format}`; register/reuse its `"output"` asset with the actual content
type and uploaded byte count; and return `{ outputAssetId, width, height, format }` from the
`runJob` work callback. Always remove the temp directory in `finally`.

- [ ] **Step 5: Register the processor and signed results**

Map `collage` to `buildCollage` in `worker/index.ts`, using
`workerConcurrencyCollage` for its concurrency. In the job GET route, parse the internal result
with Zod, resolve the output asset for the authenticated owner, and add a fresh `presignGet` URL
and expiry without exposing asset ID/key. In `worker/runJob.ts`, when a successful `collage.build`
job has a webhook, resolve its output asset for that owner and add a fresh signed URL to
`resultUrls`; failed jobs continue to send no result URLs.

- [ ] **Step 6: Verify worker and result tests**

Run: `npx vitest run tests/unit/buildCollage.test.ts tests/unit/runJob.test.ts tests/integration/collages.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add worker/processors/buildCollage.ts worker/index.ts worker/runJob.ts src/app/api/jobs/[id]/route.ts tests/unit/buildCollage.test.ts tests/unit/runJob.test.ts tests/integration/collages.test.ts
git commit -m "feat: process collage jobs and return results" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 9: Build the Browser Create and Result Flow

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/collage.spec.ts`
- Create: `src/components/providers/QueryProvider.tsx`
- Create: `src/components/collage/CollageCreateForm.tsx`
- Create: `src/features/collage/useUpload.ts`
- Create: `src/features/collage/useJob.ts`
- Create: `src/app/collages/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- `useUpload(apiKey: string)` returns `upload(files: File[]): Promise<string[]>` and per-file progress.
- `useJob(apiKey: string, jobId: string | null)` returns the `JobResponse` state and polls until
  `succeeded`, `failed`, or `cancelled`.
- `CollageCreateForm` keeps the API key in component memory and calls the upload and job hooks.
- `src/app/collages/page.tsx` reads non-secret collage limits from `getConfig()` and passes
  `maxImages`, `maxImageUploadBytes`, `maxCanvasPixels`, and `maxCanvasDimension` to the client form.

- [ ] **Step 1: Install client and Playwright dependencies**

Run: `npm install @tanstack/react-query react-hook-form @hookform/resolvers`
Run: `npm install -D @playwright/test`
Run: `npx playwright install chromium`

- [ ] **Step 2: Write the failing browser flow before building the page**

Create `playwright.config.ts` with a Next.js web server and write `tests/e2e/collage.spec.ts`. Mock
presign, MinIO PUT, collage creation, job polling, and the final signed image URL:

```ts
import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("uploads, creates, and downloads a collage", async ({ page }) => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#d22" },
  }).png().toBuffer();
  await page.route("https://minio.test/result.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  await page.route("**/api/uploads/presign", (route) =>
    route.fulfill({
      json: { url: "http://minio.test/put", key: "uploads/owner/u1/a.png", expiresInSec: 900 },
    }),
  );
  await page.route("http://minio.test/put", (route) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "PUT, OPTIONS",
      "access-control-allow-headers": "content-type",
    };
    return route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      headers,
    });
  });
  await page.route("**/api/collages", (route) => route.fulfill({ status: 202, json: { jobId: "j1" } }));
  let polls = 0;
  await page.route("**/api/jobs/j1", (route) => {
    polls += 1;
    return route.fulfill({
      json: {
        id: "j1",
        type: "collage.build",
        status: polls === 1 ? "running" : "succeeded",
        progress: polls === 1 ? 50 : 100,
        result: polls === 1 ? null : {
          output: {
            width: 1080,
            height: 1080,
            format: "png",
            downloadUrl: "https://minio.test/result.png",
            expiresInSec: 900,
          },
        },
        error: null,
      },
    });
  });
  await page.goto("/collages");
  await page.getByLabel("API key").fill("ak_test");
  await page.getByLabel("Images").setInputFiles({
    name: "a.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByLabel("Justified rows")).toBeChecked();
  await page.getByRole("button", { name: "Create collage" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download collage" })).toHaveAttribute(
    "href",
    "https://minio.test/result.png",
  );
});
```

Run: `npx playwright test tests/e2e/collage.spec.ts`
Expected: FAIL because `/collages` does not exist yet.

Add a failure/retry E2E case. Reuse the same image setup, then use these response counters:

```ts
let presignCalls = 0;
let createCalls = 0;
await page.route("https://minio.test/result.png", (route) =>
  route.fulfill({ status: 200, contentType: "image/png", body: png }),
);
await page.route("**/api/uploads/presign", (route) => {
  presignCalls += 1;
  return route.fulfill({
    json: { url: "http://minio.test/put", key: "uploads/owner/u1/a.png", expiresInSec: 900 },
  });
});
await page.route("http://minio.test/put", (route) =>
  route.fulfill({
    status: route.request().method() === "OPTIONS" ? 204 : 200,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "PUT, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  }),
);
await page.route("**/api/collages", (route) => {
  createCalls += 1;
  return route.fulfill({ status: 202, json: { jobId: `j${createCalls}` } });
});
await page.route("**/api/jobs/j*", (route) => {
  const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
  const failed = id === "j1";
  return route.fulfill({
    json: {
      id,
      type: "collage.build",
      status: failed ? "failed" : "succeeded",
      progress: 100,
      result: failed
        ? null
        : {
            output: {
              width: 1080,
              height: 1080,
              format: "png",
              downloadUrl: "https://minio.test/result.png",
              expiresInSec: 900,
            },
          },
      error: failed ? { code: "JOB_FAILED", message: "Image processing failed" } : null,
    },
  });
});

await page.getByRole("button", { name: "Create collage" }).click();
await expect(page.getByRole("alert")).toContainText("Image processing failed");
await page.getByRole("button", { name: "Retry collage" }).click();
await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();
expect(createCalls).toBe(2);
expect(presignCalls).toBe(1);
```

- [ ] **Step 3: Add the query provider and upload hook**

Create a client `QueryClientProvider`. `useUpload` requests one presigned URL per selected image,
uploads with `XMLHttpRequest` to report progress, and returns keys only after each PUT succeeds.
Pass the API key only in the Authorization header; never persist or log it.

- [ ] **Step 4: Add form and polling hook**

Use React Hook Form with `CreateCollageBody` via `zodResolver`. Show layout default, compatible
template choices, canvas presets/custom dimensions, format, file limits, and upload progress.
Use limits passed by the server page for file count, file size, and custom canvas validation.
`useJob` polls `/api/jobs/:id` until terminal status and stops polling after terminal status. Do not
include the API key in query keys or persist it in any client store.

- [ ] **Step 5: Add accessible result and retry states**

Show `aria-live` progress, visible validation and failure messages, output preview, and download
link. Retain uploaded keys in component state so retry submits a new job without re-uploading.
Keep credentials and keys only in memory.

- [ ] **Step 6: Add the collage page and navigation**

Add `/collages` as a force-dynamic server page because it reads runtime configuration. It passes
only the four collage limits named above to `CollageCreateForm`. Link to it from the landing page
and wrap the app in `QueryProvider` without changing the existing health link.

- [ ] **Step 7: Verify browser flow, typecheck, lint, and build**

Run: `npx playwright test tests/e2e/collage.spec.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json playwright.config.ts tests/e2e/collage.spec.ts src/components/providers/QueryProvider.tsx src/components/collage/CollageCreateForm.tsx src/features/collage/useUpload.ts src/features/collage/useJob.ts src/app/collages/page.tsx src/app/layout.tsx src/app/page.tsx
git commit -m "feat: add collage browser flow" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 10: Document API and Complete Verification

**Files:**
- Modify: `docs/api.md`

**Interfaces:**
- API documentation matches `CreateCollageBody`, `CreateCollageResponse`, `CollageJobResult`, and
  the webhook result URL behavior.

- [ ] **Step 1: Update API documentation**

Document the request and response examples, image size/count/pixel limits, image types (including
conditional HEIC support), all
template counts, canvas presets/custom caps, PNG/JPEG output, polling result fields, expiry behavior,
and signed webhook result URLs.

- [ ] **Step 2: Run the complete validation set**

Run: `npx playwright test tests/e2e/collage.spec.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: all unit, property, integration, and existing tests pass.

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run format:check`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add docs/api.md
git commit -m "docs: document collage API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
