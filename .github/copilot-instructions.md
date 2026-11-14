# Copilot Instructions: AutoClip & Collage Studio (Next.js full-stack, TypeScript)

Save this file as `.github/copilot-instructions.md`. It replaces any earlier Python-based version.

Use these rules whenever you generate, edit, or review code in this repository. Follow the patterns and templates here exactly. Prefer extending existing modules over creating new ones.

---

## 1. What we are building

A self-hosted web app and API with two features:

1. **Auto-clip**: ingest long videos and produce short, captioned clips (optionally 9:16) by scoring segments (speech, audio energy, motion, faces, quality, LLM hook score).
2. **Collage studio**: build **grid** and **sequence** collages from images, decide which image goes in which slot, and (optional) **reverse-detect** placements in an existing collage.

Everything, frontend and backend, is **TypeScript on Next.js**. n8n and other tools call the REST API and receive signed webhooks.

---

## 2. Core rule: Analyze, then Plan, then Render

```
Analyzer  ->  Planner  ->  Renderer
(features)    (JSON spec)   (executes spec only)
```

- **Analyzer**: extracts features (probe data, transcript, scene cuts, embeddings, face/saliency boxes, quality). Results are cached by content hash plus model version.
- **Planner**: pure, deterministic functions. Input is features, output is a validated JSON spec (EDL or LayoutSpec). **No IO, no FFmpeg, no network** inside planner code.
- **Renderer**: reads a spec and produces media. It makes no creative decisions.

If a renderer needs to "decide" something, move the decision into the planner and add a field to the spec.

### Process topology

Next.js route handlers must stay **fast and stateless**. Long work never runs inside a request.

```
Browser  ->  Next.js (UI + route handlers)  ->  Redis (BullMQ)  ->  Worker process(es)
                         |                                              |
                      Postgres  <-------------------------------------->  MinIO (S3)
                                                       optional: ML sidecar (HTTP)
```

- `app/` = UI and API route handlers.
- `worker/` = separate Node entrypoint (`tsx worker/index.ts`) that runs BullMQ processors. It shares code from `src/` but is built and run as its own container.
- ML that is impractical in Node (some ASR, face models) goes behind a small **sidecar HTTP service** accessed only through an adapter in `src/server/adapters/`. Planner code never knows about it.

---

## 3. Tech stack (use these, do not substitute without asking)

| Concern | Choice |
|---|---|
| Framework | Next.js (latest stable), **App Router**, React, TypeScript `strict` |
| Validation / contracts | **Zod** (single source of truth; infer types with `z.infer`) |
| DB | Postgres + **Drizzle ORM** + drizzle-kit migrations |
| Queue | **BullMQ** + Redis |
| Object storage | MinIO via `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` |
| Images | **sharp** |
| Video | FFmpeg / ffprobe through `node:child_process` `spawn` (argument arrays only) |
| Embeddings (CLIP) | `@huggingface/transformers` (transformers.js) in the worker, or the ML sidecar |
| ASR | whisper.cpp or faster-whisper via adapter (CLI or sidecar) |
| LLM scoring | Ollama or any OpenAI-compatible endpoint via one `LlmClient` adapter |
| UI | Tailwind CSS + shadcn/ui, lucide-react icons |
| Client state / data | TanStack Query for server state, Zustand for editor state |
| Collage editor canvas | `react-konva` |
| Testing | **Vitest**, **fast-check** (property tests), **Playwright** (e2e), MSW for HTTP mocks |
| Lint / format | ESLint (Next config) + Prettier |
| Logging | `pino` |

Do not use `fluent-ffmpeg` (unmaintained). Spawn FFmpeg directly via the helper in section 7.3.

Check the installed Next.js version's docs for current conventions (for example, whether `params` and `cookies()` are async) before generating route code.

---

## 4. Repository layout

```
src/
  app/
    (ui)/                        # pages: dashboard, videos, collages, editor
      videos/[id]/page.tsx
      collages/[id]/page.tsx
    api/
      videos/route.ts
      videos/[id]/clips/route.ts
      collages/route.ts
      collages/[id]/relayout/route.ts
      collages/detect/route.ts
      jobs/[id]/route.ts
      uploads/presign/route.ts
      health/route.ts
  components/
    ui/                          # shadcn primitives
    collage/                     # CollageCanvas, CellInspector, TemplatePicker
    video/                       # ClipList, Timeline, ClipPreview
  features/                      # client hooks per feature (useJob, useCollage)
  lib/
    schemas/                     # Zod: edl.ts, layout.ts, api.ts, job.ts  (SOURCE OF TRUTH)
    planner/
      clips/                     # candidates.ts, score.ts, mmr.ts, reframe.ts
      collage/
        grid/                    # templates.ts, justifiedRows.ts, guillotine.ts
        sequence/                # order.ts, filmstrip.ts, timeline.ts, storyboard.ts
        assign.ts                # cost matrix + assignment
        hungarian.ts             # pure TS implementation (rectangular via padding)
        detect.ts                # reverse mode (pure parts)
    utils/                       # math, ids, hash, time
  server/
    config.ts                    # env parsing with Zod
    db/                          # schema.ts, client.ts, repositories/
    queue/                       # queues.ts, events.ts
    storage/                     # s3.ts, presign.ts
    analyzers/                   # video/, image/
    renderers/                   # video.ts, collage.ts
    adapters/                    # llm.ts, asr.ts, embeddings.ts, faces.ts
    security/                    # auth.ts, hmac.ts, ssrf.ts
    http/                        # withApi.ts, errors.ts, responses.ts
worker/
  index.ts                       # BullMQ workers bootstrap
  processors/                    # analyzeVideo.ts, planClips.ts, renderClips.ts, buildCollage.ts, detectCollage.ts
tests/
  unit/  property/  integration/  e2e/  fixtures/
docker/  docs/  drizzle/
```

Rules:
- Anything under `src/lib/planner` and `src/lib/schemas` must be **isomorphic and pure**: no `fs`, no `process`, no `sharp`, no network. The browser editor imports these for live re-layout.
- Anything under `src/server` and `worker` is server-only. Add `import "server-only";` at the top of server modules that must never reach the client bundle.
- Use path alias `@/` for `src/`.

---

## 5. Data contracts (Zod, define once, infer everywhere)

### 5.1 EDL (video plan): `src/lib/schemas/edl.ts`

```ts
import { z } from "zod";

export const CropPoint = z.object({
  t: z.number().nonnegative(),        // seconds, relative to clip start
  cx: z.number().min(0).max(1),       // normalized center x
  cy: z.number().min(0).max(1),       // normalized center y
  w: z.number().min(0).max(1),        // normalized crop width
  h: z.number().min(0).max(1),        // normalized crop height
});

export const EdlClip = z.object({
  src: z.string(),                    // asset id
  start: z.number().nonnegative(),    // seconds
  end: z.number().positive(),         // seconds
  score: z.number().min(0).max(1),
  crop: z.object({
    mode: z.enum(["none", "center", "track"]),
    aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]),
    path: z.array(CropPoint).optional(),
  }),
  captions: z.object({ enabled: z.boolean(), style: z.string().default("default") }),
  audio: z.object({ normalizeLufs: z.number().default(-16) }),
}).refine((c) => c.end > c.start, { message: "end must be after start" });

export const Edl = z.object({ version: z.literal(1), clips: z.array(EdlClip).min(1) });
export type Edl = z.infer<typeof Edl>;
```

### 5.2 Layout spec (collage plan): `src/lib/schemas/layout.ts`

```ts
import { z } from "zod";

export const Cell = z.object({
  id: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  image: z.string().nullable(),                         // asset id or null if empty
  focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.5, 0.5]),
  order: z.number().int().nonnegative(),
  pinned: z.boolean().default(false),                   // user override, solver must not move it
});

export const LayoutSpec = z.object({
  version: z.literal(1),
  canvas: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    gap: z.number().int().nonnegative().default(12),
    bg: z.string().default("#ffffff"),
  }),
  mode: z.enum(["grid", "sequence"]),
  style: z.enum(["template", "justified", "guillotine", "filmstrip", "timeline", "storyboard"]),
  cells: z.array(Cell),
}).superRefine((spec, ctx) => {
  // Validator: cells inside canvas and non-overlapping. Implement in lib/planner/collage/validate.ts
  // and call it here. Report issues with ctx.addIssue.
});
export type LayoutSpec = z.infer<typeof LayoutSpec>;
```

Rules:
- All coordinates are **integers in canvas pixels**. `focus` and crop values are **normalized 0..1**. State units in names or comments (`startSec`, `px`, `norm`).
- When a schema changes, bump `version`, keep the old schema, and add an adapter in `src/lib/schemas/migrations/`.
- API request and response bodies must be Zod schemas in `src/lib/schemas/api.ts`. Never accept `any` at a boundary.

---

## 6. General code generation rules

- TypeScript `strict`, no `any` (use `unknown` + Zod parse). No non-null `!` unless justified in a comment.
- Prefer named exports, small files (< 250 lines), small functions (< 40 lines).
- Planner functions are **pure and deterministic**. If randomness is needed, take a seeded RNG as a parameter.
- Use `async/await`. Never leave floating promises. Handle errors with typed error classes from `src/server/http/errors.ts` (`AppError(code, status, message, details?)`).
- No magic numbers: weights, thresholds, and limits go in `src/server/config.ts` or a `defaults.ts` next to the module.
- Config comes from env parsed once with Zod in `src/server/config.ts`. Never read `process.env` elsewhere.
- Use `node:` prefixed imports (`node:crypto`, `node:path`, `node:child_process`).
- Temp files: create a per-job dir with `fs.mkdtemp`, and always remove it in `finally`.
- Comments explain *why*, not *what*. Add JSDoc with units for public planner functions.
- Every new module that contains logic gets a test file in the same change.

---

## 7. Backend patterns (copy these templates)

### 7.1 Route handler wrapper: `src/server/http/withApi.ts`

All route handlers use `withApi`. It handles auth, Zod validation, error envelope, and logging.

```ts
// src/app/api/collages/route.ts
import { z } from "zod";
import { withApi } from "@/server/http/withApi";
import { CreateCollageBody } from "@/lib/schemas/api";
import { collageQueue } from "@/server/queue/queues";
import { collagesRepo } from "@/server/db/repositories/collages";

export const runtime = "nodejs";          // required: sharp, crypto, bullmq need Node runtime
export const dynamic = "force-dynamic";

export const POST = withApi({ auth: "apiKey", body: CreateCollageBody }, async ({ body, ctx }) => {
  const collage = await collagesRepo.create({ ownerId: ctx.principal.id, input: body });
  const job = await collageQueue.add("build", { collageId: collage.id }, {
    jobId: `collage:${collage.id}:build`,   // idempotent
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
  return { status: 202, json: { jobId: job.id, collageId: collage.id } };
});
```

Error envelope for all failures:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": {} } }
```

### 7.2 Jobs and worker

- Queues: `video-analyze`, `video-render`, `collage`. GPU or ML-heavy queues are separate from CPU render queues so they scale independently.
- Processors live in `worker/processors/*.ts`, one file per job type. A processor loads inputs, calls analyzer, planner, and renderer in order, persists results, then enqueues or fires the webhook.
- Persist job state transitions in Postgres: `queued -> running -> succeeded | failed | cancelled`. Report progress with `job.updateProgress`.
- Processors must be **idempotent** and safe to retry. Use deterministic output keys (`outputs/{jobId}/clip-{n}.mp4`).
- Concurrency per queue comes from config.

### 7.3 FFmpeg helper: `src/server/renderers/ffmpeg.ts`

```ts
import { spawn } from "node:child_process";

export function runFfmpeg(args: string[], opts: { timeoutMs: number; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-y", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr = (stderr + d).slice(-8000); });   // keep tail only
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs);
    opts.signal?.addEventListener("abort", () => p.kill("SIGKILL"));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}
```

Rules: arguments are always an **array**; never use `exec` or shell strings; never interpolate user text into filter graphs without escaping (use a helper `escapeFilterText`). Wrap `ffprobe` the same way and parse its JSON output with Zod.

### 7.4 Storage and uploads

- Large uploads go **directly browser -> MinIO** using presigned PUT URLs from `POST /api/uploads/presign`. Never stream big files through Next.js route handlers.
- After upload, the client calls `POST /api/videos` (or `/api/collages`) with the object key. The server verifies the object exists, probes it, and records metadata.
- Serve results through short-lived presigned GET URLs.

### 7.5 Webhooks: `src/server/security/hmac.ts`

- Sign payloads with HMAC-SHA256 (`node:crypto`), header `X-Signature: sha256=<hex>` plus `X-Timestamp`. Verify with `timingSafeEqual`.
- Payload includes `eventId`, `jobId`, `type`, `status`, `resultUrls`. Receivers can dedupe on `eventId`.
- Deliver from the worker with retries and exponential backoff; store delivery attempts.

### 7.6 Auth

- API key in `Authorization: Bearer <key>` (hashed in DB). UI uses session auth (Auth.js or equivalent) if user accounts are required.
- Do the auth check inside `withApi` (route level), not only in `middleware.ts`, so it runs on the Node runtime.

---

## 8. Algorithms to implement (TypeScript)

### 8.1 Auto-clip planner (`lib/planner/clips/`)

1. Input: per-second feature arrays (speech density, audio energy, motion, face presence, quality), transcript with word timestamps, scene cuts, and optional LLM hook scores.
2. `candidates.ts`: slide windows of 15 to 60 s. **Snap start and end to sentence and scene boundaries**. Never cut mid-word.
3. `score.ts`: `score = Σ wᵢ·featureᵢ`, weights from config, normalized to 0..1.
4. `mmr.ts`: select top-K with Maximal Marginal Relevance using cosine similarity of CLIP/text embeddings to avoid near-duplicates.
5. `reframe.ts`: for 9:16, take face/saliency boxes over time, smooth with EMA, clamp to frame bounds, output `CropPoint[]`.
6. Output a validated `Edl`. Renderer converts it into FFmpeg arguments (trim, crop/scale, ASS captions, `loudnorm`, thumbnail).

### 8.2 Grid collage (`lib/planner/collage/grid/`)

- Define `interface SlotGenerator { generate(canvas, imageStats): Slot[] }` and implement:
  - **templates**: 2x2, 3x3, 1 hero + 4 small, etc.
  - **justifiedRows**: Flickr-style rows with equal height; the row width equals the canvas width (within 1 px after rounding; distribute rounding error across cells).
  - **guillotine**: recursive splits producing a mosaic with a hero cell.
- `assign.ts`: build a cost matrix and solve with `hungarian.ts`:

```
cost(i, s) = a·|ln(arImg / arSlot)| + b·cropLoss(i, s) + c·heroPenalty(i, s) + d·colorAdjacency
```

  - `cropLoss`: fraction of the face/saliency box clipped after cover-scaling into the slot.
  - `heroPenalty`: pushes higher-scored images toward larger slots.
  - Remove `pinned` cells from the problem before solving; keep them unchanged.
  - Pad rectangular matrices with zero-cost dummy rows or columns.

### 8.3 Sequence collage (`lib/planner/collage/sequence/`)

1. `order.ts`: order by EXIF time, by embedding similarity (greedy nearest-neighbor plus 2-opt improvement), or by user-supplied order.
2. Layout styles: `filmstrip`, `timeline` (alternate above/below a line with date labels), `storyboard` (panel size by importance), and a slideshow plan that the video renderer turns into Ken Burns plus `xfade` transitions.
3. Rhythm rules: alternate large and small; never place near-duplicates adjacent.

### 8.4 Collage renderer (`server/renderers/collage.ts`)

For each cell: `sharp(input).rotate()` (apply EXIF orientation first) -> `resize({ width, height, fit: "cover", position })` where position is derived from `focus` -> composite onto a canvas created with `sharp({ create: { ... } })`. Render previews from low-res proxies, finals from originals.

### 8.5 Reverse mode (`lib/planner/collage/detect.ts` + analyzer)

- Analyzer reads raw pixels with sharp and computes row/column variance projections.
- Pure code finds gutters and splits recursively (guillotine layouts).
- For free-form collages, use the optional ML sidecar (contours/SAM) behind an adapter.
- Match regions to source images by perceptual hash or CLIP similarity.
- Output the same `LayoutSpec` so results are editable in the UI.

---

## 9. Frontend rules (Next.js App Router)

- Default to **Server Components**. Add `"use client"` only for interactive pieces (editor canvas, uploaders, forms with live state).
- Data fetching: server components call repositories directly; client components use TanStack Query hitting `/api/*`. Do not duplicate server logic in the client.
- **Jobs UX**: after a `202`, poll `GET /api/jobs/:id` (or use SSE at `/api/jobs/:id/events`) through a `useJob(jobId)` hook that exposes `status`, `progress`, and `result`. Always show a progress state and a failure state with a retry.
- **Upload flow**: `useUpload()` requests a presigned URL, uploads with `XMLHttpRequest` or `fetch` for progress, then registers the asset.
- **Collage editor** (`components/collage/CollageCanvas.tsx`):
  - Uses `react-konva`. Cells are draggable and resizable; snapping to gap grid.
  - Holds the `LayoutSpec` in a Zustand store with undo/redo.
  - Dragging an image into a cell sets `pinned: true`. A "Re-layout" button calls the same planner functions (imported from `@/lib/planner`) in the browser for instant preview, then persists via `POST /api/collages/:id/relayout`.
  - The canvas must stay responsive with 100+ images (virtualize thumbnails, use proxies).
- **Video clips UI**: list candidate clips with score, a preview player, trim handles on a timeline, aspect selector, caption toggle, and "Render selected".
- Forms: `react-hook-form` + `zodResolver` using the same schemas from `lib/schemas`.
- Accessibility: keyboard-operable controls, labels on inputs, visible focus, `aria-live` for job status.
- Style with Tailwind and shadcn/ui; do not add another component library.

---

## 10. API surface

```
POST /api/uploads/presign           -> { url, key }
POST /api/videos                    { key | url }                          -> 202 { jobId, videoId }
POST /api/videos/:id/clips          { targetLenSec, aspect, count }        -> 202 { jobId }
POST /api/collages                  { images[], mode, style?, canvas }     -> 202 { jobId, collageId }
POST /api/collages/:id/relayout     { pin: { [cellId]: imageId } }         -> 202 { jobId }
POST /api/collages/detect           { imageKey, candidates[] }             -> 202 { jobId }
GET  /api/jobs/:id                  -> { status, progress, result?, error? }
GET  /api/health
```

- Long work always returns `202` and a `jobId`.
- Responses use the shared envelope; list endpoints use cursor pagination.
- Keep route files thin: validate -> call repository/queue -> respond.

---

## 11. Security rules

- Validate every input with Zod. Validate uploads by MIME type, extension, and size limits, then **probe** with ffprobe/sharp metadata before processing.
- Fetching remote URLs goes through `src/server/security/ssrf.ts` (block private and link-local IPs, limit redirects, size, and time).
- Never pass user-controlled strings into shell commands or FFmpeg filter graphs unescaped.
- Do not log secrets, API keys, or presigned URLs.
- Rate-limit public endpoints (Redis-based).
- Set sensible CORS: no wildcard with credentials.

---

## 12. Performance rules

- Cache analysis by `sha256(file) + analyzerVersion`; skip work if present.
- Analyze on **proxy media** (for example 480p video, 1024px images). Render finals from originals.
- Stream files; never read a whole video into memory. Use `pipeline` from `node:stream/promises`.
- Limit `sharp` and FFmpeg concurrency to CPU/GPU capacity; support NVENC/QSV via a config flag with a software fallback.
- Batch embedding calls. Keep heavy model loading lazy and shared per worker.
- Build with `output: "standalone"` for a small Docker image; run the worker as a separate container.

---

## 13. Testing requirements

Every change ships with tests (Vitest unless noted).

- **Unit**: scoring, snap-to-boundary, cost matrix, Hungarian solver, slot generators, Zod validators, HMAC sign/verify.
- **Property tests (fast-check)** for any layout change, asserting for arbitrary inputs:
  - cells stay inside the canvas and never overlap
  - each image is used at most once
  - pinned cells are unchanged after relayout
  - justified-row total width equals canvas width (within 1 px)
  - the planner is deterministic (same input gives same output)
- **Golden tests**: tiny fixtures in `tests/fixtures/` (2 to 3 s videos, small images). Compare spec JSON exactly; compare rendered images using a perceptual-diff threshold.
- **Integration**: call route handlers with a fake queue and in-memory or test Postgres; verify job lifecycle and webhook signature.
- **E2E (Playwright)**: upload images -> create grid collage -> drag to pin a cell -> relayout -> download result.
- Keep fixtures tiny so CI stays fast.

---

## 14. Environment variables (parsed in `src/server/config.ts`)

```
DATABASE_URL=
REDIS_URL=
S3_ENDPOINT=  S3_REGION=  S3_ACCESS_KEY=  S3_SECRET_KEY=  S3_BUCKET=
API_KEY_PEPPER=
WEBHOOK_SIGNING_SECRET=
OLLAMA_URL=            # or LLM_BASE_URL + LLM_API_KEY
ML_SIDECAR_URL=        # optional
FFMPEG_HWACCEL=none|nvenc|qsv
WORKER_CONCURRENCY_RENDER=2
WORKER_CONCURRENCY_ANALYZE=1
MAX_UPLOAD_MB=
```

---

## 15. Do and don't

**Do**
- Read `src/lib/schemas` before writing code; reuse existing models.
- Put decisions in `lib/planner`, extraction in `server/analyzers`, output in `server/renderers`.
- Set `export const runtime = "nodejs"` on route handlers that use Node APIs.
- Make small, reviewable changes with tests in the same change.
- Leave a `TODO(milestone-N)` comment instead of implementing out-of-scope features.

**Don't**
- Don't run FFmpeg, sharp, or model inference inside a request-response cycle.
- Don't import `server/*` code into client components.
- Don't use `exec`, `shell: true`, `eval`, or unvalidated `JSON.parse` on untrusted data.
- Don't change a spec shape without bumping `version` and adding a migration adapter.
- Don't add global mutable singletons for models; use lazy, injectable providers.
- Don't swallow errors; fail the job with a clear error code and message.
- Don't commit model weights or large media.

---

## 16. Milestones (stay within the current one)

1. **MVP**: Zod schemas, presigned uploads, justified-row and template grids, Hungarian assignment, sharp collage renderer, clip candidates from scene + transcript scoring, FFmpeg clip rendering, BullMQ jobs, signed webhooks, basic UI (upload, create, result view).
2. Face/saliency-aware crops (`focus`), sequence modes (filmstrip, timeline), progress UI.
3. 9:16 tracked reframing, burned-in captions, clip trim editor.
4. Collage editor with pinning and browser-side relayout; reverse-mode detector.
5. Polish: auth/accounts, rate limits, GPU encoding, observability.

When given a task, state which milestone it belongs to and avoid pulling in later scope.

---

## 17. Definition of done

- Types pass (`tsc --noEmit`), lint and format pass, tests pass (including property tests for layout changes).
- New or changed API shapes are in `lib/schemas/api.ts` and documented in `docs/api.md`.
- Spec changes are versioned with a migration adapter.
- No secrets, hardcoded paths, or unbounded resource use.
- Long-running work is in the worker, idempotent, and has progress and failure states in the UI.

---

## 18. Prompt starters for Copilot Chat

- "Create `src/lib/planner/collage/grid/justifiedRows.ts` following section 8.2, with a fast-check property test."
- "Implement `worker/processors/buildCollage.ts` per sections 7.2 and 8.4, using `LayoutSpec` and the `collagesRepo`."
- "Add `POST /api/collages/:id/relayout` using the `withApi` template, respecting pinned cells."
- "Build `CollageCanvas` with react-konva per section 9, bound to the Zustand layout store with undo/redo."