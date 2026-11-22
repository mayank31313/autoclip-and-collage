# API

The service exposes health, presigned uploads, static grid collage jobs, and job polling. Clip
creation is not yet implemented.

## Authentication and errors

Create a key with `npm run create-key -- <name>` and store it securely; it is displayed only once.
Except for health, requests require `Authorization: Bearer <key>`. Jobs are scoped to the key owner.

**Studio key (optional).** If `STUDIO_API_KEY` is set to an issued key, the web UI pre-fills the
API key field and sends no `Authorization` header; the server then authenticates the request with
the studio key. The fallback applies only when the header is absent and the browser reports
`Sec-Fetch-Site: same-origin`, and the key itself is never sent to the browser. Any client can set
that header, so anyone who can reach the server can act as the studio key's owner: use it only for
trusted, self-hosted deployments.

Errors use this envelope; `details` is always present (an empty object when there is nothing to add):

```json
{ "error": { "code": "NOT_FOUND", "message": "Job not found", "details": {} } }
```

| Status | `code`                   | Typical cause                                                                      |
| ------ | ------------------------ | ---------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`      | Invalid JSON or fields; `details.issues` lists `{ path, message }` for body errors |
| 401    | `UNAUTHORIZED`           | Missing or invalid API key                                                         |
| 404    | `NOT_FOUND`              | Unknown job, or an image key that is not yours or does not exist                   |
| 409    | `CONFLICT`               | An image key is already registered with different metadata                         |
| 413    | `PAYLOAD_TOO_LARGE`      | File or image exceeds the upload size limit                                        |
| 503    | `QUEUE_UNAVAILABLE`      | The job could not be enqueued; the job is recorded as `failed` with the same code  |
| 503    | `DEPENDENCY_UNAVAILABLE` | Health check: a dependency is down                                                 |
| 500    | `INTERNAL`               | Unexpected server error; the message is generic                                    |

Every response carries an `x-request-id` header.

## GET /api/health

No authentication is required. A healthy service returns `200`:

```json
{ "status": "ok", "checks": { "db": true, "redis": true } }
```

If a dependency fails, the response is `503`:

```json
{
  "error": {
    "code": "DEPENDENCY_UNAVAILABLE",
    "message": "A dependency is unavailable",
    "details": { "checks": { "db": true, "redis": false } }
  }
}
```

## POST /api/uploads/presign

Send a JSON body with a filename, an allowed content type, and the positive file size in bytes:

```json
{ "filename": "a.png", "contentType": "image/png", "sizeBytes": 4 }
```

The response is `200`:

```json
{ "url": "<presigned PUT URL>", "key": "<object key>", "expiresInSec": 900 }
```

The expiry is configured by the server. Accepted types are `video/mp4`, `video/quicktime`,
`video/webm`, `video/x-matroska`, `image/jpeg`, `image/png`, and `image/webp`. HEIC/HEIF is not
accepted: the packaged sharp/libvips build cannot encode or decode HEVC, so `image/heic` and
`.heic`/`.heif` filenames return `400`.
Invalid JSON or fields return `400`; missing or invalid authentication returns `401`; an upload
exceeding the configured limit returns `413` (`details.maxBytes`). Images are limited by
`MAX_IMAGE_UPLOAD_MB` (default 200); videos by `MAX_UPLOAD_MB` (default 2048). The expiry is
`PRESIGN_TTL_SEC` (default 900). Keys have the form `uploads/<ownerId>/<uploadId>/<filename>` (the filename is sanitized).

Upload the file directly to the returned URL with the same content type and size:

```sh
curl -X PUT -H "Content-Type: <type>" --data-binary @file "<url>"
```

Presigning does not verify the file contents or register an asset.

## POST /api/collages

Creates a collage job from images already uploaded through `POST /api/uploads/presign`. Each entry
in `images` is the `key` returned by presign and must belong to the authenticated key's upload
namespace. Keys must be unique and ordered; the order is the upload order used for placement ties.

Justified rows (the default layout; `template` must be omitted):

```json
{
  "images": ["uploads/<ownerId>/<uploadId>/a.jpg", "uploads/<ownerId>/<uploadId>/b.png"],
  "mode": "grid",
  "style": "justified",
  "canvas": { "w": 1920, "h": 1080 }
}
```

Photo wall (one image of framed photographs on a chosen wall):

```json
{
  "images": ["<key 1>", "<key 2>"],
  "mode": "grid",
  "style": "photo-wall",
  "photoWallPreset": "midnight",
  "canvas": { "w": 1080, "h": 1080 }
}
```

Photo-wall frames preserve the complete image in upload order. `photoWallPreset` is optional and
accepts `warm` (default), `gallery`, `midnight`, or `scrapbook`. Each preset determines the wall
background and arrangement; `canvas.bg` and `canvas.gap` do not affect photo walls.
`photoWallPreset` is rejected for other styles.

Named template (`style: "template"` requires exactly one of `template` or `customTemplate`):

```json
{
  "images": ["<key 1>", "<key 2>", "<key 3>", "<key 4>"],
  "mode": "grid",
  "style": "template",
  "template": "grid-2x2",
  "canvas": { "w": 1080, "h": 1080, "gap": 8, "bg": "#101010" },
  "format": "jpeg",
  "webhookUrl": "https://example.com/hooks/collage"
}
```

Custom template (an inline definition in the same format as the template files; `id` and `name`
are required but only used for messages):

```json
{
  "images": ["<key 1>", "<key 2>", "<key 3>"],
  "mode": "grid",
  "style": "template",
  "customTemplate": {
    "version": 1,
    "id": "my-layout",
    "name": "My layout",
    "cols": [2, 1],
    "rows": [1, 1],
    "cells": [
      { "col": 0, "row": 0, "rowSpan": 2, "hero": true },
      { "col": 1, "row": 0 },
      { "col": 1, "row": 1 }
    ]
  },
  "canvas": { "w": 1080, "h": 1080 }
}
```

Defaults: `canvas.gap` is `12` px, `canvas.bg` is `#ffffff` (`#RRGGBB`), `format` is `png`, and
`webhookUrl` is optional (http/https). `format` is the output encoding: `png` or `jpeg` (JPEG is
flattened onto the background color). `mode` is `grid` or `polaroid`; `style` (`justified`, `template`, or `photo-wall`), `template`,
`customTemplate` and `canvas` apply only to `mode: "grid"`. `template` and `customTemplate` are rejected unless the style is `template`, and sending
both returns `400`.

Canvas: `w` and `h` are positive integer pixels, `gap` is a non-negative integer. The browser
offers 1080×1080, 1080×1350, and 1920×1080 presets plus custom sizes; the API accepts any size
within the caps below (default 8192 px per side and 40 megapixels in total). A gap too wide for
the canvas and image count fails the job with `VALIDATION_FAILED`.

Template image counts: `template` is the `id` of a template listed by
`GET /api/collages/templates` and needs exactly as many images as it has cells, or `rectangular`,
which accepts any count from 1 to the maximum. A custom template also needs exactly one image per
cell. The shipped templates are:

| `template`        | Images                             |
| ----------------- | ---------------------------------- |
| `hero-2-stacked`  | exactly 3 (hero + 2 stacked)       |
| `grid-2x2`        | exactly 4                          |
| `strip-1-3`       | exactly 4 (wide hero + 3 below)    |
| `hero-4`          | exactly 5 (left hero + four small) |
| `grid-2x3`        | exactly 6                          |
| `magazine-hero-5` | exactly 6 (2×2 hero + five small)  |
| `grid-3x3`        | exactly 9                          |
| `rectangular`     | any count from 1 to the maximum    |

An unknown template id or a mismatched count returns `400`. Justified rows accept 1 to the maximum
number of images.
Images are placed automatically to minimize aspect mismatch; upload order breaks ties. Photos are
never cropped: each one is fitted whole inside its cell, and any spare space in the cell shows the
canvas background.

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
    "template": "scatter",
    "imagesPerSlide": [3, 1],
    "slideSizes": ["large", "small"],
    "captions": ["Summer 2025", "", "Road trip", "Home"]
  },
  "format": "png",
  "webhookUrl": "https://example.com/hooks/collage"
}
```

- `slideAspect` (required): `4:5` (1080×1350 px slides) or `1:1` (1080×1080 px slides).
- `template` (optional, default `scatter`): the placement style. `scatter` (tilted, two staggered
  rows), `tidy` (even sizes, nearly straight zigzag), `cascade` (stepped diagonal), or `spotlight`
  (every third polaroid is large and centred).
- `imagesPerSlide` (optional): the number of images on each slide, in order. Each entry is 1 to 6
  and the entries must add up to the number of images. When `slides` is omitted it is the length of
  this array. Defaults to an even split, with earlier slides taking the remainder.
- `slideSizes` (optional): `small`, `medium`, or `large` for each slide, one entry per slide.
  `large` (the default) is the biggest polaroid that fits the slide's photo count; `medium` and
  `small` are 85% and 70% of that. Where a large polaroid would crowd a neighbouring slide, it is
  shrunk slightly to stay clear.
- `slides` (optional): 2 to 10. Defaults to about three images per slide (`ceil(images / 3)`, kept
  between 2 and 10). There must be at least one image per slide and at most six per slide.
- `captions` (optional): exactly one entry per image, up to 60 characters each, plain text. An empty
  string leaves that polaroid's caption strip blank. Captions are written in a handwriting font.
- `format` (`png` or `jpeg`, default `png`) applies to the slides. Placement is automatic and
  deterministic for the same ordered images.
- Photos are never cropped. Each polaroid's photo window takes the shape of its photo, so portrait
  photos get taller frames and landscape photos wider ones. Photos more extreme than 1:2 or 2:1 are
  fitted whole inside a 1:2 or 2:1 window, leaving a little frame colour above and below or at the
  sides.

The response is the same `202` with a `jobId` (the job `type` is `collage.polaroid`).

Limits (server configuration, defaults shown):

| Limit                          | Default        | Environment variable                 | Enforced                   |
| ------------------------------ | -------------- | ------------------------------------ | -------------------------- |
| Images per collage             | 20             | `COLLAGE_MAX_IMAGES`                 | On create (`400`)          |
| Bytes per image                | 200 MB         | `MAX_IMAGE_UPLOAD_MB`                | Presign and create (`413`) |
| Canvas side                    | 8192 px        | `COLLAGE_MAX_DIMENSION`              | On create (`400`)          |
| Canvas area                    | 40 megapixels  | `COLLAGE_MAX_CANVAS_PIXELS`          | On create (`400`)          |
| Decoded pixels per input image | 200 megapixels | `COLLAGE_MAX_INPUT_PIXELS`           | In the worker              |
| Polaroid spread area           | 20 megapixels  | `COLLAGE_POLAROID_MAX_SPREAD_PIXELS` | On create (`400`)          |

Supported image types are `image/jpeg`, `image/png`, and `image/webp` with a `.jpg`, `.jpeg`,
`.png`, or `.webp` extension. HEIC/HEIF is not supported in this build: the packaged sharp/libvips
lacks HEVC decoding, so `.heic`/`.heif` keys and `image/heic`/`image/heif` are rejected. The stored
object's actual content type and size are checked on create (and uploaded metadata is not proof of
the contents); the worker's decoder is authoritative, so a corrupt image or one over the pixel
limit fails the job with `VALIDATION_FAILED`. Collage worker concurrency is
`WORKER_CONCURRENCY_COLLAGE` (default 1). Polaroid captions use the font at `POLAROID_FONT_PATH`
(default `assets/fonts/Caveat-Regular.ttf`, SIL OFL); the worker image must contain it.

The response is `202` and contains only the job ID (there is no separate collage resource):

```json
{ "jobId": "00000000-0000-0000-0000-000000000001" }
```

Poll `GET /api/jobs/:id` for status and progress. Errors: `400` for invalid JSON or fields,
duplicate keys, limit or template violations, or an unsupported type, extension, or missing size;
`401` for missing or invalid authentication; `404` when a key is outside your namespace or the
object does not exist (the two cases are indistinguishable); `409` when the key is already
registered with different metadata; `413` when an object exceeds the image size limit; `503`
`QUEUE_UNAVAILABLE` when the job cannot be enqueued. No job is processed for a rejected request.

## GET /api/collages/templates

Lists the collage templates the server read from `COLLAGE_TEMPLATES_DIR` (default
`assets/collage-templates`; one `<id>.json` file per template, where the id must match the
filename). Templates are sorted by cell count, then id. Requires authentication. The response is
`200`:

```json
{
  "templates": [
    {
      "version": 1,
      "id": "grid-2x2",
      "name": "2×2 grid",
      "description": "Four equal tiles.",
      "cols": [1, 1],
      "rows": [1, 1],
      "cells": [
        { "col": 0, "row": 0, "colSpan": 1, "rowSpan": 1, "hero": false },
        { "col": 1, "row": 0, "colSpan": 1, "rowSpan": 1, "hero": false },
        { "col": 0, "row": 1, "colSpan": 1, "rowSpan": 1, "hero": false },
        { "col": 1, "row": 1, "colSpan": 1, "rowSpan": 1, "hero": false }
      ]
    }
  ]
}
```

Template format:

- `cols` / `rows`: relative track weights (1 to 12 tracks, integers 1 to 100). Tracks share
  the canvas minus gaps in proportion to their weights.
- `cells`: `col`/`row` are 0-based track indices, `colSpan`/`rowSpan` default to 1, and `hero`
  (default `false`) marks at most one cell for the most important image. Cells must stay inside
  the grid and must not overlap; grid areas not covered by a cell are left as background.
- The id `rectangular` is reserved. Files are read once and cached; restart the server after
  editing them. An invalid file makes this endpoint and collage creation fail with an error
  naming the file.

## GET /api/jobs/:id

For a job owned by the authenticated key, the response is `200` with `id`, `type`, `status`,
`progress` (0–100), `result`, and `error`. A succeeded collage job (`type` is `collage.build`):

```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "type": "collage.build",
  "status": "succeeded",
  "progress": 100,
  "result": {
    "output": {
      "width": 1080,
      "height": 1080,
      "format": "png",
      "downloadUrl": "<short-lived signed GET URL>",
      "expiresInSec": 900
    }
  },
  "error": null
}
```

`result.output` has `width` and `height` (px), `format` (`png` or `jpeg`), `downloadUrl`, and
`expiresInSec`. For a collage job `result` is `null` until it succeeds and stays `null` if it
fails; a failed job returns `error` with a `code` and `message` (otherwise `error` is `null`).

Expiry: a fresh signed URL is generated on every poll and is not stored. It is valid for
`expiresInSec` seconds (the presign TTL, `PRESIGN_TTL_SEC`, default 900); poll again for a new URL
after it expires. The output object and asset ID are not otherwise exposed.

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

Statuses are `queued`, `running`, `succeeded`, `failed`, and `cancelled`. Worker failures caused by
bad input (a 4xx error such as `VALIDATION_FAILED` or `NOT_FOUND`, except `408` and `429`) are not
retried: the job fails immediately with that code and message. Other failures are retried (up to 3
attempts with exponential backoff) and then fail with a generic `Job failed` message (code
`JOB_FAILED` for unexpected errors).
An unknown, malformed, or other owner's ID returns `404`; missing or invalid authentication
returns `401`.

## Webhooks

Jobs created with a `webhookUrl` send a JSON `POST` when they reach `succeeded` or `failed`
(not on intermediate retries):

```json
{
  "eventId": "<uuid>",
  "jobId": "00000000-0000-0000-0000-000000000001",
  "type": "collage.build",
  "status": "succeeded",
  "resultUrls": ["<short-lived signed GET URL>"]
}
```

`resultUrls` contains the output download URL only for a succeeded collage job; for a polaroid job
it lists the ZIP URL first, then one URL per slide in order; it is signed at
delivery time with the same TTL as polling (`PRESIGN_TTL_SEC`) and is an empty array for failed jobs
(or if the result cannot be resolved). Receivers should deduplicate using `eventId`. Requests
include `X-Timestamp` (Unix seconds) and `X-Signature: sha256=<hex>`. The signature is HMAC-SHA256
using the configured signing secret (`WEBHOOK_SIGNING_SECRET`) over the UTF-8 bytes of
`${timestamp}.${rawBody}`. The receiver URL must resolve to a public address, and redirects are not
followed. Failed delivery (non-2xx or network error) is retried up to 5 attempts with exponential
backoff; attempts are recorded on a best-effort basis, and a failed delivery never fails the job.
