# Foundation (Sub-project 1 of Milestone 1) – Design

Source of truth for conventions: `.github/copilot-instructions.md`. This spec covers only the shared foundation. Collage MVP and Video MVP are separate follow-up specs. Milestones 2–5 come after that.

## Goal
A runnable, tested Next.js + worker skeleton with contracts, config, DB, queue, storage, security and job plumbing, so feature work (collage, video) only adds planners, analyzers, renderers, processors and UI.

## Decisions
- Package manager: npm. Node LTS (installed v26.13.1).
- Dev infra via `docker-compose.yml` (Postgres, Redis, MinIO). App and worker run on the host.
- Auth: API key (`Authorization: Bearer`), peppered hash in DB, checked inside `withApi`. UI session auth is deferred to Milestone 5.
- UI: only a minimal landing page with a health indicator.

## Components
| Unit | Purpose | Depends on |
|---|---|---|
| `src/lib/schemas/{edl,layout,api,job}.ts` | Zod contracts, inferred types; layout validator in `lib/planner/collage/validate.ts` | zod |
| `src/server/config.ts` | Env parsed once with Zod | zod |
| `src/server/http/{errors,responses,withApi}.ts` | `AppError`, error envelope, route wrapper (auth + body/query validation + logging) | config, db, schemas |
| `src/server/db/*` | Drizzle schema + migrations: `api_keys`, `assets`, `jobs`, `webhook_deliveries`; repositories | postgres |
| `src/server/queue/*` | BullMQ queues `video-analyze`, `video-render`, `collage`; job-state persistence | redis, db |
| `src/server/storage/*` | S3 client, presigned PUT/GET | MinIO |
| `src/server/security/{hmac,ssrf,auth}.ts` | Webhook signing/verify, SSRF guard, API-key hashing | config |
| `src/server/renderers/{ffmpeg,ffprobe}.ts` | Spawn helpers (args arrays only), Zod-parsed ffprobe | ffmpeg |
| `worker/index.ts`, `worker/processors/*` | BullMQ bootstrap, placeholder processors, webhook delivery with retry/backoff | queue, db |
| Routes | `GET /api/health`, `POST /api/uploads/presign`, `GET /api/jobs/:id` | withApi |

## Data flow
Request → `withApi` (auth, Zod) → repository/queue → `202 {jobId}`. Worker pulls job → persists `queued→running→succeeded|failed|cancelled` → fires signed webhook (stored attempts) → client polls `GET /api/jobs/:id`.

## Error handling
All failures use `{ "error": { "code", "message", "details" } }` via `AppError(code, status, message, details?)`. Unknown errors map to `INTERNAL` without leaking details. Secrets and presigned URLs are never logged (pino redaction).

## Testing
- Unit (Vitest): config, HMAC sign/verify (incl. timing-safe and timestamp skew), SSRF guard, API-key hash, `withApi`, layout validator, schemas.
- Property (fast-check): layout validator accepts non-overlapping in-canvas cells and rejects violations.
- Integration: route handlers with a fake queue and mocked repositories.
- Smoke (needs Docker): health, presign, job lifecycle.

## Out of scope
Collage/clip planners, analyzers, renderers, editor UI, session auth, rate limiting (Milestone 5), GPU encoding.

## Definition of done
`tsc --noEmit`, lint, format check and tests pass; `docs/api.md` documents the three routes; `.env.example` lists all variables from section 14 of the instructions.
