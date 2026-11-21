# Polaroid carousel collage mode: design

Milestone 2 (sequence-style layouts). Extends the collage flow; grid mode is unchanged.

## Goal

Turn uploaded images into polaroid-style prints placed on one wide "diary spread" that is sliced into N
carousel slides (seamless: polaroids may straddle slide seams). The spread looks like a torn paper sheet
glued onto a diary page. Output is a ZIP of all slides plus per-slide URLs for an in-page carousel preview.

## API contract (`src/lib/schemas/api.ts`)

`CreateCollageBody` becomes a union discriminated on `mode`. The `"grid"` body is unchanged.

`"polaroid"` body:

- `images: string[]` (same key rules as grid; unique, non-HEIC, at most `collageMaxImages`).
- `polaroid: { slides?: int 2..10, slideAspect: "4:5" | "1:1", captions?: string[] }`
  - `slides` defaults to `clamp(ceil(images / 3), 2, 10)`.
  - `captions`, when present, has exactly one entry per image; each entry is 0..60 characters of
    plain text (empty string = no caption).
  - `images.length >= slides` (every slide gets at least one polaroid).
- `format` (png | jpeg, default png) applies to slides. `webhookUrl` optional.
- No `canvas`: slide width is fixed (`POLAROID_SLIDE_WIDTH_PX = 1080`); height is 1350 (4:5) or 1080 (1:1).

Result (`PolaroidJobResult`), selected by job type `collage.polaroid`:

```
{ output: { slideCount, slideWidth, slideHeight, slideFormat,
            zipUrl, slides: [{ index, url }], expiresInSec } }
```

All URLs are freshly presigned on read; asset IDs and keys are never exposed. The grid `CollageJobResult`
is untouched.

## Spec and planner (`src/lib/schemas/polaroid.ts`, `src/lib/planner/collage/polaroid/`)

`PolaroidSpec` (version 1) is separate from `LayoutSpec` because polaroids rotate and overlap.

- `spread: { w, h }` px; `slide: { w, h, count }` px.
- `polaroids[]`: `id`, `image` (asset id), `caption`, frame `x, y, w, h` px (unrotated frame, integer),
  `rotationDeg` (|rot| <= 6), `tape` (variant id).
- `paper`: `seed`, torn-edge polylines (px points), page/texture parameters.

Planner is pure and deterministic: seeded RNG derived from the ordered image ids. It places polaroids left
to right across the spread with alternating sizes and vertical jitter, allows seam straddling, keeps every
rotated bounding box inside the spread, guarantees at least one polaroid centre per slide, and bounds
pairwise overlap. A validator checks these invariants; the schema calls it in `superRefine`.

## Renderer (`src/server/renderers/polaroid.ts`)

Reads only the spec. Everything is drawn procedurally with sharp and SVG (no image assets):

1. Diary page: cream paper, ruled lines, faint margin line, binding stitches.
2. Torn sheet: rough-edged polygon with a lighter fibrous rim and soft shadow, glued over the page.
3. Per polaroid: EXIF-rotate and cover-resize the photo, white frame with thick bottom strip, shadow,
   rotation on a transparent background, tape strips, caption in the bottom strip.
4. Composite sequentially onto the spread, `extract` N slides, encode, and write a ZIP.

Captions are rendered with sharp text using a bundled OFL handwriting font (Caveat) through `fontfile`;
text is escaped so it cannot inject Pango markup. The font file lives in `assets/fonts/` and is copied
into the worker image. One small zip dependency is added (chosen in the plan).

## Worker (`worker/processors/buildPolaroid.ts`)

New job type `collage.polaroid` on the existing `collage` queue. It reuses the download, inspect and
temp-dir flow (shared helpers extracted from `buildCollage.ts`, no behaviour change). Idempotent keys:
`outputs/{jobId}/slide-{n}.{ext}` and `outputs/{jobId}/polaroid.zip`. Stores `PolaroidWorkerResult`
(zip asset id, slide asset ids, dimensions). New config caps: max slides, max caption length, max spread
pixels (re-checked in the worker). Progress: downloads, plan, render, upload.

## UI

The create form gets a Grid | Polaroid carousel toggle. In polaroid mode, style, template and canvas
fields are hidden and the form shows slide count (auto default), aspect choice (4:5 / 1:1) and optional
per-image caption inputs. The result view shows an accessible carousel preview (previous/next, slide
counter, `aria-live`) built from `slides[]`, plus a ZIP download. Failure and progress states reuse the
existing components.

## Testing

- Property tests (fast-check): all polaroids inside the spread, each image used once, deterministic,
  at least one polaroid per slide, overlap bounded.
- Unit: request and result schemas, caption validation, paper edge determinism, caption escaping,
  result resolver (asset ownership), processor with fakes, form schema and body builder.
- Renderer test with tiny generated fixtures: slide count and dimensions, ZIP entry count.
- `docs/api.md` updated with the new body and result.

## Out of scope

Editing polaroid positions in a browser editor, non-diary backgrounds, video slideshows.
