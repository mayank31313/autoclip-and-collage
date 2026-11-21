# API

The foundation exposes the routes below. Clip and collage creation endpoints and media processing
are not yet implemented.

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
`video/webm`, `video/x-matroska`, `image/jpeg`, `image/png`, `image/webp`, and `image/heic`.
Invalid JSON or fields return `400`; missing or invalid authentication returns `401`; an upload
exceeding the configured limit returns `413`.

Upload the file directly to the returned URL with the same content type and size:

```sh
curl -X PUT -H "Content-Type: <type>" --data-binary @file "<url>"
```

Presigning does not verify the file contents or register an asset.

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
