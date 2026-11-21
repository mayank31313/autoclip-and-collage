# Collage MVP – Design

This is the second sub-project after the Foundation. It implements static grid collages only.
Video MVP and later collage capabilities remain separate sub-projects.

## Goal

Let an API client or browser user upload images directly to object storage, create a deterministic,
crop-aware grid collage, and retrieve the finished image through a short-lived signed URL.

## Approved product decisions

- One collage job accepts 1–20 images. The maximum is configurable.
- Justified rows are the default. The UI also offers exact-fit templates:
  - `grid-2x2`: exactly 4 images
  - `grid-3x3`: exactly 9 images
  - `hero-4`: exactly 5 images
  - `rectangular`: exact-count rectangular grids for 1–20 images
- Image-to-cell assignment is automatic and minimizes crop/aspect mismatch. For `hero-4`, the
  highest-resolution image is favored for the hero cell. Upload order is the deterministic tie-breaker.
- PNG is the default output; JPEG is optional. The canvas background defaults to white and the gap
  defaults to 12 px.
- The UI offers 1080×1080, 1080×1350, and 1920×1080 presets, plus custom dimensions.
- Custom canvases are limited to 40 megapixels and 8192 px on either side.
- Per-image upload size is limited to 200 MB; decoded dimensions are limited to 200 megapixels.
  These limits and the 20-image cap are configurable.
- The browser asks for an API key and keeps it in page memory only. It is not written to local or
  session storage.
- The job is the only collage resource. There is no separate persisted editable collage entity or
  `collageId`; creation returns a `jobId`.
- Automatic placement optimizes crop loss and resolution only. Color adjacency is out of scope.
- Out of scope: sequence layouts, face/saliency-aware crops, manual editor/pinning, reverse
  detection, animation, and user accounts/session authentication.

## Architecture

```text
Browser
  ├─ POST /api/uploads/presign ──> short-lived PUT URL
  ├─ PUT image directly to MinIO
  ├─ POST /api/collages ──> { jobId }
  └─ poll GET /api/jobs/:id ──> status and, on success, fresh download URL

Next.js route ──> validate/record source assets ──> Postgres job + BullMQ collage queue
                                                        │
                                                        v
Worker: fetch sources -> inspect -> plan -> render -> upload output -> persist output asset
```

### Request path

`POST /api/collages` uses `withApi` and Zod source-of-truth schemas in
`src/lib/schemas/api.ts`: `CreateCollageBody`, `CreateCollageResponse`, and `CollageJobResult`. It
accepts unique uploaded object keys, grid style, template selection when applicable, canvas
settings, output format, and an optional webhook URL. It returns `202 { "jobId": "..." }`.

Before enqueueing, the route:

1. Authenticates the API key and checks that every key belongs to that principal's upload namespace.
2. Checks that each object exists, is within the configured image byte limit, has an allowed image
   MIME type, and has an allowed extension.
3. Registers the inputs as owner-scoped `image` assets. Registration is idempotent for a key already
   owned by the same principal; a key owned by someone else is never exposed.
4. Validates template/image-count compatibility and canvas limits.
5. Creates a `collage.build` job on the existing `collage` queue. The persisted job input contains
   source asset IDs and requested options. BullMQ payloads continue to carry only `jobId` and `type`.

The presign route applies a new image-specific cap while preserving the existing video upload cap.
Object metadata supplied during upload is not treated as proof of file contents; the worker's image
decoder is authoritative.

### Worker and persistence

Replace the placeholder collage processor with `buildCollage`. It runs through the existing `runJob`
state/retry wrapper and:

1. Loads the job and owner-scoped source assets.
2. Downloads each source into a per-job temporary directory, enforcing byte limits, then reads
   orientation-aware metadata and decodes each image with sharp.
3. Rejects invalid media and input dimensions over the configured pixel ceiling with a safe,
   user-facing job error.
4. Calls pure planners to construct and validate a `LayoutSpec`.
5. Renders the validated spec with sharp and uploads to a deterministic key:
   `outputs/{jobId}/collage.{png|jpeg}`.
6. Registers or reuses the owner-scoped output asset and returns its asset ID and output metadata as
   the internal job result.
7. Removes the temporary directory in `finally`.

The output asset key is deterministic so a BullMQ retry can overwrite the same output. Asset
registration is idempotent. No signed URL is persisted in the job row.

`GET /api/jobs/:id` remains owner-scoped. For a successful collage job it resolves the internal
output asset ID, checks that the asset belongs to the job owner, and signs a fresh GET URL on each
request. Its public result is:

```json
{
  "output": {
    "width": 1080,
    "height": 1080,
    "format": "png",
    "downloadUrl": "<short-lived signed GET URL>",
    "expiresInSec": 900
  }
}
```

The output asset ID and object key are not exposed. The completion webhook includes the same
short-lived URL in `resultUrls`; failed jobs have no result URL. The URL lifetime uses the existing
presign TTL configuration.

## Planner and renderer

### Image features

The image analyzer extracts only oriented width, height, aspect ratio, and pixel count. It does not
perform face, saliency, semantic, or color analysis. The packaged sharp/libvips build must be tested
for every enabled input format. HEIC is accepted only when that build can decode the fixture; if not,
HEIC is excluded from collage input validation and presigning.

### Layout generation

Planner code remains pure, deterministic, and browser-safe under `src/lib/planner/collage`.
Coordinates are integer canvas pixels and all output is validated as a `LayoutSpec` before render.

- A one-image input occupies the entire canvas.
- `justified` uses equal-height rows. Set row count to
  `clamp(round(sqrt(imageCount / canvasAspect)), 1, imageCount)`. Split inputs in upload order into
  contiguous rows as evenly as possible, assigning any extra cells to earlier rows. Cell widths are
  proportional to source aspect ratios; each row fills the inner canvas width within one pixel, with
  rounding remainder distributed left-to-right.
- `grid-2x2` and `grid-3x3` use equal cells.
- `hero-4` gives half of the canvas to one large cell and uses a 2×2 group in the remaining half.
  The large cell is on the wider side for landscape canvases and above the smaller cells for
  portrait/square canvases.
- `rectangular` uses the same deterministic row-count and balanced row partition as `justified`, but
  divides each row into equal-width cells. It never emits empty cells.

### Assignment

The planner builds a rectangular image-to-slot cost matrix and solves it with the pure TypeScript
Hungarian implementation. The cost uses normalized aspect mismatch/cover-crop loss and a resolution
penalty for the hero slot. It does not use color adjacency. The assignment is deterministic; stable
input order breaks ties. Each input image appears exactly once.

### Rendering

The renderer accepts a validated layout and source assets and makes no layout decisions. For each
cell it applies EXIF rotation, cover-resizes to the assigned cell, and composites onto the configured
canvas background with the configured gap. PNG and JPEG encoders are supported; JPEG output is
flattened onto the background. Rendering is sequential within each job, and collage worker
concurrency defaults to one to bound native image memory use.

## API contract

The request uses the existing presigned upload flow. Example justified request:

```json
{
  "images": ["uploads/<owner-id>/<upload-id>/one.jpg"],
  "mode": "grid",
  "style": "justified",
  "canvas": { "w": 1080, "h": 1080, "gap": 12, "bg": "#ffffff" },
  "format": "png"
}
```

Example template request:

```json
{
  "images": ["uploads/<owner-id>/<upload-id>/one.jpg"],
  "mode": "grid",
  "style": "template",
  "template": "rectangular",
  "canvas": { "w": 1080, "h": 1350 },
  "format": "jpeg",
  "webhookUrl": "https://receiver.example/hook"
}
```

The schema rejects duplicate keys, unsupported modes/styles/formats, invalid canvas values (positive
integer dimensions and `#RRGGBB` backgrounds), and missing/inapplicable template IDs. The route
applies configurable count/area/side limits and checks curated template counts before creating a job.
Presign, create, job polling, and webhook failures use the standard
`{ error: { code, message, details } }` envelope.

## Browser flow

The collage page accepts multiple images, displays the 1–20/configured count and per-image size
limits, and offers layout, canvas, and output-format controls. The layout defaults to justified.
The user enters an API key in a password field; the key remains only in component memory and is
never logged or persisted.

The client requests a presigned URL per image and uploads directly to MinIO with progress. After
uploads finish, it submits their object keys to `POST /api/collages`, then polls
`GET /api/jobs/:id`. It shows accessible progress and failure states, and on success displays the
collage with a download link. Retry submits a new job using the already-uploaded object keys; it
does not silently retry malformed media. The page has no persisted collage history.

## Configuration

Add validated environment settings in `src/server/config.ts` and `.env.example`:

| Setting | Default | Purpose |
|---|---:|---|
| `MAX_IMAGE_UPLOAD_MB` | `200` | Maximum bytes per image upload |
| `COLLAGE_MAX_IMAGES` | `20` | Maximum number of images in one job |
| `COLLAGE_MAX_INPUT_PIXELS` | `200000000` | Maximum decoded pixels per input |
| `COLLAGE_MAX_CANVAS_PIXELS` | `40000000` | Maximum output canvas area |
| `COLLAGE_MAX_DIMENSION` | `8192` | Maximum custom canvas side |
| `WORKER_CONCURRENCY_COLLAGE` | `1` | Maximum concurrent collage jobs |

`MAX_UPLOAD_MB` remains the video/general upload limit. Collage jobs use bounded storage downloads,
sharp input pixel limits, per-job temporary directories, and configured worker concurrency.

## Testing and acceptance

- Unit tests cover request/result schemas, image metadata validation, template matching, assignment,
  row rounding, and sharp output format/dimensions.
- Property tests assert deterministic output, in-canvas non-overlapping cells, exact image use,
  justified row width within one pixel, and exact-count rectangular grids.
- Worker/route integration tests use fake queues and object storage to verify ownership checks,
  upload validation, job lifecycle, output asset persistence, and fresh signed URLs.
- Tiny image fixtures cover EXIF orientation, PNG/JPEG rendering, malformed images, and pixel-limit
  rejection.
- Playwright exercises upload, create, job polling, and result download using a mocked object-store
  and API boundary. No model or large-media fixtures are added.
- `docs/api.md` documents the request, job result, failure envelope, limits, and webhook output.
- Completion requires typecheck, lint, formatting, unit/property/integration tests, and production
  build to pass.

## Dependencies and repository fit

Use the existing Next.js App Router, Zod, Drizzle, BullMQ, MinIO, Tailwind, and shadcn patterns.
Add `sharp` for image inspection/rendering. The browser flow follows the repository's stated
TanStack Query and React Hook Form/Zod resolver patterns; add those dependencies if they are still
absent. Add Playwright for the focused browser flow test if it is not already configured.

Keep the route thin and the analyzer, planner, renderer, and worker separated. Do not add a collage
table, editor store, sequence planner, or image model dependency in this sub-project.
