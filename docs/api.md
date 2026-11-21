# API

The foundation exposes the routes below. Clip creation and the collage job's result payload (output
download URL) are not yet implemented.

## Authentication and errors

Create a key with `npm run create-key -- <name>` and store it securely; it is displayed only once.
Except for health, requests require `Authorization: Bearer <key>`. Jobs are scoped to the key owner.

Errors use this envelope; `details` is included when available:

```json
{ "error": { "code": "NOT_FOUND", "message": "Job not found", "details": {} } }
```

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
exceeding the configured limit returns `413`.

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

Defaults: `canvas.gap` is `12` px, `canvas.bg` is `#ffffff` (`#RRGGBB`), `format` is `png` (`jpeg` is
also accepted), and `webhookUrl` is optional (http/https). Only `mode: "grid"` is supported.

Template image counts: `grid-2x2` requires exactly 4 images, `grid-3x3` exactly 9, `hero-4`
(one hero plus four small) exactly 5, and `rectangular` accepts any count from 1 to the maximum.

Limits (server configuration, defaults shown): at most 20 images (`COLLAGE_MAX_IMAGES`); each
image at most 200 MB (`MAX_IMAGE_UPLOAD_MB`); canvas at most 8192 px per side
(`COLLAGE_MAX_DIMENSION`) and 40 megapixels (`COLLAGE_MAX_CANVAS_PIXELS`). Images must be
`image/jpeg`, `image/png`, or `image/webp` with a `.jpg`, `.jpeg`, `.png`, or `.webp` extension;
HEIC/HEIF is not accepted. The stored object's actual content type and size are checked; decoding
and the decoded pixel limit are enforced by the worker.

The response is `202` and contains only the job ID:

```json
{ "jobId": "00000000-0000-0000-0000-000000000001" }
```

Poll `GET /api/jobs/:id` for status and progress. Errors: `400` for invalid JSON, duplicate keys,
limit or template violations, or an unsupported type, extension, or missing size; `401` for missing
or invalid authentication; `404` when a key is outside your namespace or the object does not exist
(the two cases are indistinguishable); `409` when the key is already registered with different
metadata; `413` when an object exceeds the image size limit. No job is created for a rejected
request.

## GET /api/jobs/:id

For a job owned by the authenticated key, the response is `200`:

```json
{
  "id": "00000000-0000-0000-0000-000000000001",
  "type": "smoke",
  "status": "succeeded",
  "progress": 100,
  "result": { "note": "placeholder processor" },
  "error": null
}
```

Statuses are `queued`, `running`, `succeeded`, `failed`, and `cancelled`. `result` and `error`
may be null; an error has `code` and `message`. An unknown, malformed, or other owner's ID returns
`404`; missing or invalid authentication returns `401`.

## Webhooks

Worker jobs configured with a webhook URL send JSON containing `eventId`, `jobId`, `type`,
`status`, and `resultUrls`. Receivers should deduplicate using `eventId`. Requests include
`X-Timestamp` (Unix seconds) and `X-Signature: sha256=<hex>`. The signature is HMAC-SHA256 using
the configured signing secret over the UTF-8 bytes of `${timestamp}.${rawBody}`. Failed delivery is
retried with exponential backoff; attempts are recorded on a best-effort basis.
