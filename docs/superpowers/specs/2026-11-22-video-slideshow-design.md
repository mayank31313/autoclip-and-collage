# Video slideshow collage mode: design

Milestone 2 (mixed-media sequence layouts). Extends the existing collage flow; grid and polaroid modes
remain unchanged.

## Goal

Let a user create a slideshow collage from uploaded images and videos. The slideshow accepts a mixed
source list, an ordered timeline of slides, per-source duration or video in/out trim values, a canvas
aspect, and an allowed transition. The worker produces one MP4 master and one MP4 for every slide,
then packages the slide MP4s in a ZIP.

## Source model

The browser may upload existing image types and these video types:

- `video/mp4`
- `video/quicktime`
- `video/webm`
- `video/x-matroska`

An uploaded source is recorded as an asset with kind `image` or `video`. The slideshow request uses
ordered source entries:

```ts
{
  key: string;
  kind: "image" | "video";
  durationSec?: number;
  startSec?: number;
  endSec?: number;
  fit?: "cover" | "contain";
}
```

The route verifies ownership and the object exists, probes videos with `ffprobe`, and probes images with
sharp. It rejects audio-only, unsupported, missing, foreign, over-limit, or unprobeable sources.

- Images require `durationSec` between 1 and `SLIDESHOW_MAX_SLIDE_SEC`.
- Videos default to their full probed duration, capped by `SLIDESHOW_MAX_SLIDE_SEC`.
- If a video sets `durationSec`, it is treated as the trim duration and must match the final
  `endSec - startSec` window; the in/out window remains authoritative.
- `startSec >= 0`, `endSec > startSec`, and `endSec <= probed duration`.
- `fit` defaults to `cover`.
- Source count is 1..`COLLAGE_MAX_IMAGES`.
- No source key may repeat.

## API contract

`CreateCollageBody` remains a discriminated union. `"grid"` and `"polaroid"` are unchanged. A new
`"slideshow"` member is added:

```ts
{
  mode: "slideshow";
  sources: SlideshowSource[];
  slideshow: {
    canvas: "16:9" | "9:16" | "1:1";
    fps: 24 | 30;
    transition: "cut" | "fade" | "wipe";
    transitionSec: number;
  };
  format: "mp4";
  webhookUrl?: string;
}
```

- `canvas` defaults to `16:9` and maps to `1920x1080`, `1080x1920`, or `1080x1080`.
- `fps` defaults to `30`.
- `transitionSec` is at least 0 and at most 2 seconds.
- `cut` requires `transitionSec === 0`.
- The request and all nested values are validated with Zod before route logic.

The route checks source limits and ownership, probes every source, registers assets, and returns
`202 { jobId }`.

The public succeeded-job result is `SlideshowJobResult`:

```ts
{
  output: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    format: "mp4";
    masterUrl: string;
    zipUrl: string;
    slides: Array<{ index: number; durationSec: number; url: string }>;
    expiresInSec: number;
  }
}
```

Master and slide URLs are freshly presigned on every job poll. Asset IDs and object keys remain internal.

## Pure timeline contract

Add `src/lib/schemas/slideshow.ts` as the source of truth for the request options and versioned renderer
spec.

`SlideshowSpec` contains:

- `version: 1`
- `canvas: { w: number; h: number }`
- `fps`
- `transition: { type: "cut" | "fade" | "wipe"; durationSec }`
- `slides`: ordered entries containing `id`, `assetId`, `kind`, `startSec`, `endSec`, `fit`,
  `durationSec`
- `masterDurationSec`

The isomorphic planner in `src/lib/planner/slideshow/plan.ts` accepts probed assets and requested options,
normalizes source durations, and produces the validated spec. It performs no IO, FFmpeg calls, network
requests, sharp operations, or random choices. Given identical input it always returns identical JSON.

The validator guarantees positive slide durations, bounds, at least one slide, unique asset usage,
normalized in/out ranges, valid canvas dimensions, transition duration rules, and a master duration
consistent with overlapping transitions.

## Worker architecture

`mode: "slideshow"` creates a `collage.slideshow` job on the existing `collage` queue. This keeps media
rendering separate from the request cycle and reuses BullMQ retry and idempotency patterns.

The processor:

1. Loads and validates the persisted worker input.
2. Downloads owned source assets to a per-job temporary directory.
3. Normalizes every slide independently to the same dimensions, pixel format, frame rate, audio
   presence, and encoded time base.
4. Renders every per-slide MP4.
5. Builds the master MP4 with cuts or a filtergraph supported by FFmpeg.
6. Writes a ZIP of the per-slide MP4 files.
7. Uploads the master, slide MP4s, and ZIP under deterministic keys:
   `outputs/{jobId}/master.mp4`, `outputs/{jobId}/slide-{n}.mp4`, and
   `outputs/{jobId}/slideshow.zip`.
8. Persists the asset IDs and public dimensions in the job result.

Progress is reported at source download, normalization, master render, and upload phases. Failures remain
typed job errors and never expose internal paths or command output.

## FFmpeg rendering

The renderer is server-only and reads only `SlideshowSpec` plus normalized source paths. Arguments are
always arrays. There is no shell, `exec`, or user text in filter graphs.

For images, `ffmpeg` creates a looped, cover-scaled source at the requested duration.

For videos:

- `-ss` and `-t` define the deterministic source trim.
- `-an` is used where no normalized audio track exists.
- No-audio slides are padded with silence only for master timeline consistency.
- Dimensions are normalized with an explicitly escaped, non-shell filtergraph.

The master uses:

- Direct concatenation for `cut`.
- `xfade=fade` for fade transitions.
- `xfade=wipeleft` or an equivalent fixed wipe mode for wipe transitions.

No filtergraph interpolation of source filenames or captions is allowed. All source paths are argument
values or are mapped by generated index.

## Per-slide ZIP

The existing `src/server/renderers/zip.ts` writes a ZIP from slide files. It will remain bounded by the
maximum slide count and will use stored names `slide-{n}.mp4`.

## UI

The collage create form gains a Slideshow mode alongside Grid and Polaroid. It accepts mixed image/video
files and shows type-specific controls:

- Image: duration.
- Video: source preview, in/out trim fields, and duration.
- Shared: canvas aspect, frame rate, transition type, transition duration.
- MP4 format is fixed.

The existing progress and failure components are reused. The result view shows an HTML5 master preview,
slide count/duration metadata, per-slide download links, and a ZIP download.

The API key remains in page memory. Mixed uploads reuse the existing presign/XHR upload flow.

## Config

Server config adds:

- `SLIDESHOW_MAX_SLIDES` (default 20)
- `SLIDESHOW_MAX_SLIDE_SEC` (default 30)
- `SLIDESHOW_MAX_DURATION_SEC` (default 300)
- `SLIDESHOW_MAX_TRANSITION_SEC` (default 2)

Presigned upload limits reuse the existing video/image maximum sizes. A video source is not allowed to
make the resulting master exceed `SLIDESHOW_MAX_DURATION_SEC`.

## Testing

- Unit: Zod request/spec schemas, source ownership, media probe parsing, timeline normalization,
  duration and transition rules, worker input/result parsing.
- Property tests: deterministic planning, every slide inside bounds, unique asset usage, valid trims,
  transition overlap consistency, and master duration calculation.
- Integration: presign mixed media, slideshow route creates a queued job, polling resolves master/slide
  asset ownership and signed URLs.
- Worker: fake assets/download/probe/FFmpeg produce deterministic asset/result references.
- Golden/render test: small image/video fixtures produce expected dimensions, frame count, and a valid
  ZIP entry list.
- E2E: upload mixed image/video sources, set trim/duration and transition, create, preview MP4, and
  download ZIP.

`docs/api.md` is updated with the slideshow request and result.

## Out of scope

Auto-clipping from transcripts or scene analysis, audio ducking, captions, browser timeline editing,
non-FFmpeg transitions, GPU encoding defaults, browser-side slideshow rendering, and export beyond MP4
plus the slide ZIP.
