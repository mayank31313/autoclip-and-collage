# API

The service exposes health, presigned uploads, static grid collage jobs, and job polling. Clip
creation is not yet implemented.

## Authentication and errors

Create a key with `npm run create-key -- <name>` and store it securely; it is displayed only once.
Except for health, requests require `Authorization: Bearer <key>`. Jobs are scoped to the key owner.

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

Curated template (`template` is required with `style: "template"`):

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

Defaults: `canvas.gap` is `12` px, `canvas.bg` is `#ffffff` (`#RRGGBB`), `format` is `png`, and
`webhookUrl` is optional (http/https). `format` is the output encoding: `png` or `jpeg` (JPEG is
flattened onto the background color). Only `mode: "grid"` is supported; `style` is `justified` or
`template`. A `template` is rejected with `style: "justified"`.

Canvas: `w` and `h` are positive integer pixels, `gap` is a non-negative integer. The browser
offers 1080×1080, 1080×1350, and 1920×1080 presets plus custom sizes; the API accepts any size
within the caps below (default 8192 px per side and 40 megapixels in total). A gap too wide for
the canvas and image count fails the job with `VALIDATION_FAILED`.

Template image counts:

| `template`    | Images                           |
| ------------- | -------------------------------- |
| `grid-2x2`    | exactly 4                        |
| `grid-3x3`    | exactly 9                        |
| `hero-4`      | exactly 5 (one hero, four small) |
| `rectangular` | any count from 1 to the maximum  |

A mismatched count returns `400`. Justified rows accept 1 to the maximum number of images.
Images are placed automatically to minimize crop and aspect mismatch; upload order breaks ties.

Limits (server configuration, defaults shown):

| Limit                          | Default        | Environment variable        | Enforced                   |
| ------------------------------ | -------------- | --------------------------- | -------------------------- |
| Images per collage             | 20             | `COLLAGE_MAX_IMAGES`        | On create (`400`)          |
| Bytes per image                | 200 MB         | `MAX_IMAGE_UPLOAD_MB`       | Presign and create (`413`) |
| Canvas side                    | 8192 px        | `COLLAGE_MAX_DIMENSION`     | On create (`400`)          |
| Canvas area                    | 40 megapixels  | `COLLAGE_MAX_CANVAS_PIXELS` | On create (`400`)          |
| Decoded pixels per input image | 200 megapixels | `COLLAGE_MAX_INPUT_PIXELS`  | In the worker              |

Supported image types are `image/jpeg`, `image/png`, and `image/webp` with a `.jpg`, `.jpeg`,
`.png`, or `.webp` extension. HEIC/HEIF is not supported in this build: the packaged sharp/libvips
lacks HEVC decoding, so `.heic`/`.heif` keys and `image/heic`/`image/heif` are rejected. The stored
object's actual content type and size are checked on create (and uploaded metadata is not proof of
the contents); the worker's decoder is authoritative, so a corrupt image or one over the pixel
limit fails the job with `VALIDATION_FAILED`. Collage worker concurrency is
`WORKER_CONCURRENCY_COLLAGE` (default 1).

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

`resultUrls` contains the output download URL only for a succeeded collage job; it is signed at
delivery time with the same TTL as polling (`PRESIGN_TTL_SEC`) and is an empty array for failed jobs
(or if the result cannot be resolved). Receivers should deduplicate using `eventId`. Requests
include `X-Timestamp` (Unix seconds) and `X-Signature: sha256=<hex>`. The signature is HMAC-SHA256
using the configured signing secret (`WEBHOOK_SIGNING_SECRET`) over the UTF-8 bytes of
`${timestamp}.${rawBody}`. The receiver URL must resolve to a public address, and redirects are not
followed. Failed delivery (non-2xx or network error) is retried up to 5 attempts with exponential
backoff; attempts are recorded on a best-effort basis, and a failed delivery never fails the job.
