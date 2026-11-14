# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable, tested Next.js + BullMQ worker skeleton with Zod contracts, config, DB, queue, storage, security and job plumbing, ready for the Collage and Video sub-projects.

**Architecture:** Next.js App Router route handlers are thin and stateless (`withApi` wrapper). Long work is queued in BullMQ and run by a separate `worker/` Node process. Postgres (Drizzle) holds job/asset/key state, MinIO holds media. Planner and schema code is pure and isomorphic.

**Tech Stack:** Next.js (latest stable, App Router), TypeScript strict, Zod, Drizzle + postgres-js, BullMQ + ioredis, `@aws-sdk/client-s3`, pino, Vitest, fast-check, Tailwind + shadcn/ui, tsx.

**Spec:** `docs/superpowers/specs/2026-11-15-foundation-design.md` (conventions: `.github/copilot-instructions.md`)

## Global Constraints

- Package manager is **npm**. Node LTS (v26.13.1 installed). On Windows PowerShell, refresh PATH per shell if `node` is missing: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- TypeScript `strict`; no `any`; use `unknown` + Zod at boundaries. Path alias `@/` = `src/`.
- Named exports; files < 250 lines; functions < 40 lines; `node:` prefixed imports.
- `src/lib/schemas` and `src/lib/planner` are pure and isomorphic (no `fs`, `process`, network).
- `server-only` rule: the worker runs under plain Node via `tsx`, where the `server-only` package throws. So `import "server-only";` goes only in modules the worker never imports (`src/server/http/withApi.ts`). Modules shared with the worker (`src/server/**` other than `http/`) omit it. Vitest aliases `server-only` to a stub.
- `process.env` is read only in `src/server/config.ts` (and tooling configs `drizzle.config.ts`, `scripts/*` that call `loadConfig`).
- Route handlers: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`.
- All failures use the envelope `{ "error": { "code", "message", "details" } }` via `AppError(code, status, message, details?)`.
- Never log secrets, API keys or presigned URLs.
- FFmpeg: `spawn` with argument arrays only; never `exec` or `shell: true`.
- Every module with logic ships with a test file in the same task. Commit at the end of each task with trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Before writing route code, read the installed Next.js docs in `node_modules/next/dist/docs` (or nextjs.org) to confirm whether `params` is a `Promise` (Next 15+: it is).

---

## File Structure

```
.env.example  docker-compose.yml  drizzle.config.ts  vitest.config.ts  next.config.ts
scripts/create-api-key.ts
src/lib/schemas/{edl,layout,api,job}.ts
src/lib/planner/collage/validate.ts
src/lib/utils/cn.ts                      (moved from shadcn's src/lib/utils.ts)
src/server/config.ts  logger.ts
src/server/http/{errors,responses,withApi}.ts
src/server/security/{hmac,auth,ssrf,principal}.ts
src/server/db/{schema,client}.ts  db/repositories/{apiKeys,jobs,webhookDeliveries}.ts
src/server/jobs/state.ts
src/server/queue/queues.ts
src/server/storage/{s3,keys,presign}.ts
src/server/renderers/{ffmpeg,ffprobe}.ts
src/server/webhooks/deliver.ts
src/app/api/health/route.ts  uploads/presign/route.ts  jobs/[id]/route.ts
src/app/page.tsx
worker/index.ts  worker/runJob.ts  worker/processors/placeholder.ts
tests/{unit,property,integration}/...   tests/stubs/server-only.ts
docs/api.md
```

---

### Task 1: Scaffold, tooling and dev infrastructure

**Files:**
- Create: `package.json` (via create-next-app), `vitest.config.ts`, `tests/stubs/server-only.ts`, `docker-compose.yml`, `.env.example`, `.prettierrc.json`, `tests/unit/sanity.test.ts`
- Modify: `next.config.ts`, `package.json` scripts, `tsconfig.json`

**Interfaces:**
- Produces: npm scripts `dev, build, lint, typecheck, format, format:check, test, worker, db:generate, db:migrate, create-key`; Vitest alias `@` → `src`; `.env.example` with every variable below.

- [ ] **Step 1: Scaffold Next.js in the existing folder**

```powershell
cd D:\Projects\autoclip-and-collage
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```
If it refuses because the directory is non-empty, scaffold into `..\_scaffold`, then copy everything except `.git` into the project and delete `_scaffold`.
Expected: `package.json`, `src/app/page.tsx`, `next.config.ts` exist. Confirm `tsconfig.json` has `"strict": true`.

- [ ] **Step 2: Install dependencies**

```powershell
npm i zod drizzle-orm postgres bullmq ioredis @aws-sdk/client-s3 @aws-sdk/s3-request-presigner pino server-only
npm i -D drizzle-kit tsx vitest fast-check prettier eslint-config-prettier
npx shadcn@latest init -d
```
Then move shadcn's helper to avoid clashing with the `lib/utils/` directory: move `src/lib/utils.ts` to `src/lib/utils/cn.ts`, set `"utils": "@/lib/utils/cn"` in `components.json`, and fix imports in `src/components/ui/*`.

- [ ] **Step 3: Write config files**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```
`tests/stubs/server-only.ts`:
```ts
export {};
```
`next.config.ts` — add `output: "standalone"` to the exported config.

`.prettierrc.json`:
```json
{ "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```
`package.json` scripts (merge):
```json
{
  "typecheck": "tsc --noEmit",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "worker": "tsx --env-file=.env worker/index.ts",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "node --env-file=.env node_modules/drizzle-kit/bin.cjs migrate",
  "create-key": "tsx --env-file=.env scripts/create-api-key.ts"
}
```
Add `.prettierignore` containing `.next`, `node_modules`, `drizzle/meta`, `docs/superpowers`. Add `.env` to `.gitignore` (create-next-app already ignores `.env*`; add `!.env.example`).

`.env.example`:
```
DATABASE_URL=postgres://autoclip:autoclip@localhost:5432/autoclip
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=autoclip
API_KEY_PEPPER=change-me-to-a-long-random-string
WEBHOOK_SIGNING_SECRET=change-me-to-another-long-random-string
OLLAMA_URL=
ML_SIDECAR_URL=
FFMPEG_HWACCEL=none
WORKER_CONCURRENCY_RENDER=2
WORKER_CONCURRENCY_ANALYZE=1
MAX_UPLOAD_MB=2048
LOG_LEVEL=info
```
`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: autoclip, POSTGRES_PASSWORD: autoclip, POSTGRES_DB: autoclip }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
      MINIO_API_CORS_ALLOW_ORIGIN: "http://localhost:3000"
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
  createbucket:
    image: minio/mc
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "until mc alias set local http://minio:9000 minioadmin minioadmin; do sleep 1; done;
      mc mb --ignore-existing local/autoclip"
volumes: { pgdata: {}, miniodata: {} }
```
Copy `.env.example` to `.env`.

- [ ] **Step 4: Sanity test, then run everything**

`tests/unit/sanity.test.ts`:
```ts
import { describe, expect, it } from "vitest";
describe("tooling", () => {
  it("runs vitest with the @ alias", async () => {
    const mod = await import("@/lib/utils/cn");
    expect(typeof mod.cn).toBe("function");
  });
});
```
Run: `npm run test` → PASS; `npm run typecheck` → no errors; `npm run lint` → clean; `docker compose up -d` then `docker compose ps` → postgres, redis, minio running.

- [ ] **Step 5: Commit**
```powershell
git add -A; git commit -m "chore: scaffold Next.js, tooling and dev infrastructure`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Zod schemas and layout validator

**Files:**
- Create: `src/lib/schemas/edl.ts`, `src/lib/schemas/layout.ts`, `src/lib/schemas/job.ts`, `src/lib/schemas/api.ts`, `src/lib/planner/collage/validate.ts`
- Test: `tests/unit/schemas.test.ts`, `tests/property/layoutValidate.test.ts`

**Interfaces:**
- Produces:
  - `validateLayout(spec: { canvas: { w: number; h: number }; cells: ReadonlyArray<{ id: number; x: number; y: number; w: number; h: number; image: string | null }> }): LayoutIssue[]` where `LayoutIssue = { cellId: number; message: string }`
  - `Edl`, `EdlClip`, `CropPoint`, `LayoutSpec`, `Cell` (Zod schemas + inferred types)
  - `JobStatus` (`"queued"|"running"|"succeeded"|"failed"|"cancelled"`), `JobResponse`
  - `PresignBody` `{ filename: string; contentType: string; sizeBytes: number }`, `PresignResponse` `{ url: string; key: string; expiresInSec: number }`
  - `ALLOWED_UPLOAD_TYPES: readonly string[]`

- [ ] **Step 1: Write the failing tests**

`tests/unit/schemas.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Edl } from "@/lib/schemas/edl";
import { LayoutSpec } from "@/lib/schemas/layout";
import { PresignBody } from "@/lib/schemas/api";

const clip = {
  src: "a1", start: 1, end: 5, score: 0.5,
  crop: { mode: "none", aspect: "16:9" },
  captions: { enabled: false },
  audio: {},
};

describe("Edl", () => {
  it("accepts a valid clip and applies defaults", () => {
    const edl = Edl.parse({ version: 1, clips: [clip] });
    expect(edl.clips[0].audio.normalizeLufs).toBe(-16);
    expect(edl.clips[0].captions.style).toBe("default");
  });
  it("rejects end <= start", () => {
    expect(Edl.safeParse({ version: 1, clips: [{ ...clip, end: 1 }] }).success).toBe(false);
  });
});

describe("LayoutSpec", () => {
  const base = {
    version: 1,
    canvas: { w: 100, h: 100 },
    mode: "grid",
    style: "template",
  };
  const cell = (id: number, x: number, y: number) => ({ id, x, y, w: 50, h: 50, image: null, order: id });
  it("accepts non-overlapping in-canvas cells", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 0, 0), cell(1, 50, 0)] }).success).toBe(true);
  });
  it("rejects overlapping cells", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 0, 0), cell(1, 25, 0)] }).success).toBe(false);
  });
  it("rejects cells outside the canvas", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 75, 0)] }).success).toBe(false);
  });
  it("rejects non-integer coordinates", () => {
    expect(LayoutSpec.safeParse({ ...base, cells: [cell(0, 0.5, 0)] }).success).toBe(false);
  });
});

describe("PresignBody", () => {
  it("rejects unsupported content types", () => {
    expect(PresignBody.safeParse({ filename: "a.exe", contentType: "application/x-msdownload", sizeBytes: 10 }).success).toBe(false);
  });
  it("accepts video/mp4", () => {
    expect(PresignBody.safeParse({ filename: "a.mp4", contentType: "video/mp4", sizeBytes: 10 }).success).toBe(true);
  });
});
```
`tests/property/layoutValidate.test.ts`:
```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateLayout } from "@/lib/planner/collage/validate";

const canvas = { w: 200, h: 200 };

describe("validateLayout (property)", () => {
  it("accepts any grid of disjoint cells inside the canvas", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), (cols, rows) => {
        const w = Math.floor(canvas.w / cols);
        const h = Math.floor(canvas.h / rows);
        const cells = Array.from({ length: cols * rows }, (_, i) => ({
          id: i, x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h, image: null,
        }));
        expect(validateLayout({ canvas, cells })).toEqual([]);
      }),
    );
  });

  it("flags any pair of cells that share area", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1, max: 99 }),
        (x, y, dx, dy) => {
          const a = { id: 0, x, y, w: 100, h: 100, image: null };
          const b = { id: 1, x: x + dx, y: y + dy, w: 100, h: 100, image: null };
          const issues = validateLayout({ canvas: { w: 400, h: 400 }, cells: [a, b] });
          expect(issues.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("is deterministic", () => {
    const cells = [{ id: 0, x: 0, y: 0, w: 300, h: 10, image: null }];
    expect(validateLayout({ canvas, cells })).toEqual(validateLayout({ canvas, cells }));
  });
});
```
- [ ] **Step 2: Run and confirm failure**
Run: `npx vitest run tests/unit/schemas.test.ts tests/property/layoutValidate.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/planner/collage/validate.ts`:
```ts
export interface LayoutIssue {
  cellId: number;
  message: string;
}

interface RectCell {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Checks that every cell lies inside the canvas and that no two cells overlap.
 * All values are integer canvas pixels. Pure and deterministic.
 */
export function validateLayout(spec: {
  canvas: { w: number; h: number };
  cells: ReadonlyArray<RectCell & { image: string | null }>;
}): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const { canvas, cells } = spec;
  for (const c of cells) {
    if (c.x + c.w > canvas.w || c.y + c.h > canvas.h) {
      issues.push({ cellId: c.id, message: "cell extends outside the canvas" });
    }
  }
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (overlaps(cells[i], cells[j])) {
        issues.push({ cellId: cells[j].id, message: `cell overlaps cell ${cells[i].id}` });
      }
    }
  }
  return issues;
}

function overlaps(a: RectCell, b: RectCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
```
`src/lib/schemas/edl.ts`: copy verbatim from section 5.1 of `.github/copilot-instructions.md`.

`src/lib/schemas/layout.ts`: copy section 5.2 and replace the `superRefine` body with:
```ts
}).superRefine((spec, ctx) => {
  for (const issue of validateLayout(spec)) {
    ctx.addIssue({ code: "custom", message: issue.message, path: ["cells", issue.cellId] });
  }
});
```
with `import { validateLayout } from "@/lib/planner/collage/validate";`. (If your installed Zod rejects `code: "custom"` typing, use `z.ZodIssueCode.custom`.)

`src/lib/schemas/job.ts`:
```ts
import { z } from "zod";

export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobResponse = z.object({
  id: z.string(),
  type: z.string(),
  status: JobStatus,
  progress: z.number().int().min(0).max(100),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type JobResponse = z.infer<typeof JobResponse>;

/** Data carried on the BullMQ job; the full input lives in Postgres. */
export const JobData = z.object({ jobId: z.string().uuid(), type: z.string() });
export type JobData = z.infer<typeof JobData>;
```
`src/lib/schemas/api.ts`:
```ts
import { z } from "zod";

export const ALLOWED_UPLOAD_TYPES = [
  "video/mp4", "video/quicktime", "video/webm", "video/x-matroska",
  "image/jpeg", "image/png", "image/webp", "image/heic",
] as const;

export const PresignBody = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  sizeBytes: z.number().int().positive(),
});
export type PresignBody = z.infer<typeof PresignBody>;

export const PresignResponse = z.object({
  url: z.string(),
  key: z.string(),
  expiresInSec: z.number().int().positive(),
});
export type PresignResponse = z.infer<typeof PresignResponse>;
```
- [ ] **Step 4: Verify** — `npx vitest run tests/unit/schemas.test.ts tests/property/layoutValidate.test.ts` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git add -A; git commit -m "feat: add Zod contracts and layout validator"` (with trailer).

---

### Task 3: Config, logger and error envelope

**Files:**
- Create: `src/server/config.ts`, `src/server/logger.ts`, `src/server/http/errors.ts`, `src/server/http/responses.ts`
- Test: `tests/unit/config.test.ts`, `tests/unit/errors.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: Record<string, string | undefined>): Config`, `getConfig(): Config` (memoized, reads `process.env`), `type Config`
  - `class AppError extends Error { code: ErrorCode; status: number; details?: unknown; constructor(code, status, message, details?) }`
  - `type ErrorCode = "VALIDATION_FAILED"|"UNAUTHORIZED"|"NOT_FOUND"|"CONFLICT"|"PAYLOAD_TOO_LARGE"|"SSRF_BLOCKED"|"QUEUE_UNAVAILABLE"|"DEPENDENCY_UNAVAILABLE"|"JOB_FAILED"|"INTERNAL"`
  - `errorBody(err: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } }`
  - `logger` (pino, redacts `authorization`, `*.apiKey`, `*.secret`, `*.url`)

- [ ] **Step 1: Failing tests**

`tests/unit/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/server/config";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/d",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000", S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s", S3_BUCKET: "b",
  API_KEY_PEPPER: "p".repeat(16), WEBHOOK_SIGNING_SECRET: "w".repeat(16),
};

describe("loadConfig", () => {
  it("parses a valid env and applies defaults", () => {
    const c = loadConfig(valid);
    expect(c.ffmpegHwaccel).toBe("none");
    expect(c.workerConcurrencyRender).toBe(2);
    expect(c.maxUploadBytes).toBe(2048 * 1024 * 1024);
  });
  it("coerces numeric values", () => {
    expect(loadConfig({ ...valid, MAX_UPLOAD_MB: "10" }).maxUploadBytes).toBe(10 * 1024 * 1024);
  });
  it("treats empty optional values as undefined", () => {
    expect(loadConfig({ ...valid, OLLAMA_URL: "" }).ollamaUrl).toBeUndefined();
  });
  it("throws listing missing variables", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it("rejects short secrets", () => {
    expect(() => loadConfig({ ...valid, API_KEY_PEPPER: "short" })).toThrow(/API_KEY_PEPPER/);
  });
});
```
`tests/unit/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { AppError, errorBody } from "@/server/http/errors";

describe("errorBody", () => {
  it("maps AppError to its status and envelope", () => {
    const r = errorBody(new AppError("NOT_FOUND", 404, "nope", { id: 1 }));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "NOT_FOUND", message: "nope", details: { id: 1 } } });
  });
  it("hides unknown error details", () => {
    const r = errorBody(new Error("db password is hunter2"));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(r.body)).not.toContain("hunter2");
  });
});
```
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement**

`src/server/http/errors.ts`:
```ts
export type ErrorCode =
  | "VALIDATION_FAILED" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "PAYLOAD_TOO_LARGE"
  | "SSRF_BLOCKED" | "QUEUE_UNAVAILABLE" | "DEPENDENCY_UNAVAILABLE" | "JOB_FAILED" | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorBody(err: unknown) {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message, details: err.details ?? {} } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Internal server error", details: {} } },
  };
}
```
Adjust the first test expectation if `details` default differs: AppError without details yields `{}`; the test above passes details explicitly.

`src/server/http/responses.ts`:
```ts
export interface ApiResult {
  status?: number;
  json: unknown;
}
```
`src/server/config.ts`:
```ts
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  API_KEY_PEPPER: z.string().min(16),
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  OLLAMA_URL: optionalUrl,
  ML_SIDECAR_URL: optionalUrl,
  FFMPEG_HWACCEL: z.enum(["none", "nvenc", "qsv"]).default("none"),
  WORKER_CONCURRENCY_RENDER: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_ANALYZE: z.coerce.number().int().positive().default(1),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(2048),
  PRESIGN_TTL_SEC: z.coerce.number().int().positive().default(900),
  WEBHOOK_TOLERANCE_SEC: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export function loadConfig(env: Record<string, string | undefined>) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid environment: ${names}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    s3: {
      endpoint: e.S3_ENDPOINT, region: e.S3_REGION, accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY, bucket: e.S3_BUCKET,
    },
    apiKeyPepper: e.API_KEY_PEPPER,
    webhookSecret: e.WEBHOOK_SIGNING_SECRET,
    ollamaUrl: e.OLLAMA_URL,
    mlSidecarUrl: e.ML_SIDECAR_URL,
    ffmpegHwaccel: e.FFMPEG_HWACCEL,
    workerConcurrencyRender: e.WORKER_CONCURRENCY_RENDER,
    workerConcurrencyAnalyze: e.WORKER_CONCURRENCY_ANALYZE,
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
    presignTtlSec: e.PRESIGN_TTL_SEC,
    webhookToleranceSec: e.WEBHOOK_TOLERANCE_SEC,
    logLevel: e.LOG_LEVEL,
  };
}

export type Config = ReturnType<typeof loadConfig>;

let cached: Config | undefined;
/** The only place `process.env` is read. */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
```
`src/server/logger.ts`:
```ts
import pino from "pino";

// Log level comes from the validated config at first use would create a cycle with tests,
// so the logger reads it lazily via getConfig only when env is complete.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "*.apiKey", "*.secret", "*.url", "authorization"],
});
```
(`logger.ts` is the single allowed exception for reading `LOG_LEVEL` because config validation can fail before logging is possible; keep that comment.)

- [ ] **Step 4:** `npx vitest run tests/unit/config.test.ts tests/unit/errors.test.ts` → PASS; typecheck clean.
- [ ] **Step 5: Commit** — `feat: add config, logger and error envelope`.

---

### Task 4: Security primitives (HMAC, API keys, SSRF)

**Files:**
- Create: `src/server/security/hmac.ts`, `src/server/security/auth.ts`, `src/server/security/ssrf.ts`
- Test: `tests/unit/hmac.test.ts`, `tests/unit/auth.test.ts`, `tests/unit/ssrf.test.ts`

**Interfaces:**
- Consumes: `AppError` (Task 3)
- Produces:
  - `signPayload(args: { secret: string; body: string; timestamp: number }): string` → `"sha256=<hex>"`
  - `verifySignature(args: { secret: string; body: string; signature: string; timestamp: number; toleranceSec: number; nowSec?: number }): boolean`
  - `generateApiKey(): string`, `hashApiKey(key: string, pepper: string): string`, `parseBearer(header: string | null): string | null`
  - `isPrivateIp(ip: string): boolean`, `assertPublicUrl(raw: string, resolve?: Resolver): Promise<URL>`, `safeFetch(raw: string, opts: SafeFetchOptions, deps?: SafeFetchDeps): Promise<Response>`
  - `type Resolver = (host: string) => Promise<string[]>`

- [ ] **Step 1: Failing tests**

`tests/unit/hmac.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "@/server/security/hmac";

const secret = "s".repeat(32);
const body = JSON.stringify({ eventId: "e1" });

describe("hmac", () => {
  it("signs with sha256= prefix and verifies", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature({ secret, body, signature: sig, timestamp: 1000, toleranceSec: 300, nowSec: 1100 })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(verifySignature({ secret, body: body + " ", signature: sig, timestamp: 1000, toleranceSec: 300, nowSec: 1000 })).toBe(false);
  });
  it("rejects stale timestamps", () => {
    const sig = signPayload({ secret, body, timestamp: 1000 });
    expect(verifySignature({ secret, body, signature: sig, timestamp: 1000, toleranceSec: 300, nowSec: 2000 })).toBe(false);
  });
  it("rejects malformed signatures without throwing", () => {
    expect(verifySignature({ secret, body, signature: "nope", timestamp: 1000, toleranceSec: 300, nowSec: 1000 })).toBe(false);
  });
});
```
`tests/unit/auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, parseBearer } from "@/server/security/auth";

describe("auth helpers", () => {
  it("generates unique prefixed keys", () => {
    const a = generateApiKey();
    expect(a).toMatch(/^ak_[A-Za-z0-9_-]{40,}$/);
    expect(generateApiKey()).not.toBe(a);
  });
  it("hashes deterministically and depends on the pepper", () => {
    expect(hashApiKey("k", "pepper-pepper-pepper")).toBe(hashApiKey("k", "pepper-pepper-pepper"));
    expect(hashApiKey("k", "pepper-pepper-pepper")).not.toBe(hashApiKey("k", "other-pepper-other"));
  });
  it("parses bearer headers", () => {
    expect(parseBearer("Bearer abc")).toBe("abc");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
});
```
`tests/unit/ssrf.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp, safeFetch } from "@/server/security/ssrf";

const publicResolver = async () => ["93.184.216.34"];

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "blocks %s", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPrivateIp(ip)).toBe(false));
});

describe("assertPublicUrl", () => {
  it("allows public hosts", async () => {
    await expect(assertPublicUrl("https://example.com/a.mp4", publicResolver)).resolves.toBeInstanceOf(URL);
  });
  it("blocks non-http schemes, credentials and private literals", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", publicResolver)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    await expect(assertPublicUrl("http://u:p@example.com/", publicResolver)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    await expect(assertPublicUrl("http://127.0.0.1/", publicResolver)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    await expect(assertPublicUrl("http://[::1]/", publicResolver)).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("blocks hostnames that resolve to private addresses", async () => {
    await expect(assertPublicUrl("http://evil.test/", async () => ["10.0.0.5"])).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
});

describe("safeFetch", () => {
  const opts = { maxBytes: 10, timeoutMs: 1000, maxRedirects: 2 };
  it("follows a redirect and returns the body", async () => {
    const calls: string[] = [];
    const fetchImpl = async (u: string | URL) => {
      calls.push(String(u));
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/x" } })
        : new Response("hello");
    };
    const res = await safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver });
    expect(await res.text()).toBe("hello");
    expect(calls).toEqual(["https://example.com/a", "https://cdn.example.com/x"]);
  });
  it("blocks a redirect to a private address", async () => {
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    await expect(safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver })).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("limits redirects", async () => {
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } });
    await expect(safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver })).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });
  it("rejects oversized bodies by content-length", async () => {
    const fetchImpl = async () => new Response("x", { headers: { "content-length": "999" } });
    await expect(safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("errors the stream when the body exceeds maxBytes", async () => {
    const fetchImpl = async () => new Response("this body is far longer than ten bytes");
    const res = await safeFetch("https://example.com/a", opts, { fetch: fetchImpl, resolve: publicResolver });
    await expect(res.text()).rejects.toBeDefined();
  });
});
```
- [ ] **Step 2:** Run the three files → FAIL.
- [ ] **Step 3: Implement**

`src/server/security/hmac.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** Signs `${timestampSec}.${body}` so a captured signature cannot be replayed with a new timestamp. */
export function signPayload(args: { secret: string; body: string; timestamp: number }): string {
  const mac = createHmac("sha256", args.secret).update(`${args.timestamp}.${args.body}`).digest("hex");
  return `sha256=${mac}`;
}

export function verifySignature(args: {
  secret: string;
  body: string;
  signature: string;
  timestamp: number;
  toleranceSec: number;
  nowSec?: number;
}): boolean {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - args.timestamp) > args.toleranceSec) return false;
  const expected = Buffer.from(signPayload(args));
  const actual = Buffer.from(args.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```
`src/server/security/auth.ts`:
```ts
import { createHmac, randomBytes } from "node:crypto";

export function generateApiKey(): string {
  return `ak_${randomBytes(32).toString("base64url")}`;
}

/** Keys are high-entropy, so a peppered HMAC (no slow KDF) is sufficient and keeps auth fast. */
export function hashApiKey(key: string, pepper: string): string {
  return createHmac("sha256", pepper).update(key).digest("hex");
}

export function parseBearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
```
`src/server/security/ssrf.ts`:
```ts
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/server/http/errors";

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip.toLowerCase());
  return true; // not an IP at all: fail closed
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateV6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;
  const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateV4(dotted[1]);
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

const blocked = (msg: string) => new AppError("SSRF_BLOCKED", 400, msg);

export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw blocked("Only http(s) URLs are allowed");
  if (url.username || url.password) throw blocked("Credentials in URLs are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) throw blocked("URL resolves to a non-public address");
  return url;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}
export interface SafeFetchDeps {
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  resolve: Resolver;
}

/**
 * Fetches a remote URL re-validating every redirect hop and capping size and time.
 * TODO(milestone-5): pin the validated IP to defeat DNS rebinding between check and connect.
 */
export async function safeFetch(
  raw: string,
  opts: SafeFetchOptions,
  deps: SafeFetchDeps = { fetch: (u, i) => fetch(u, i), resolve: defaultResolver },
): Promise<Response> {
  let current = raw;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const url = await assertPublicUrl(current, deps.resolve);
    const res = await deps.fetch(url, { redirect: "manual", signal });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return capBody(res, opts.maxBytes);
  }
  throw blocked("Too many redirects");
}

function capBody(res: Response, maxBytes: number): Response {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", 413, "Remote file too large");
  if (!res.body) return res;
  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) controller.error(new AppError("PAYLOAD_TOO_LARGE", 413, "Remote file too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, { status: res.status, headers: res.headers });
}
```
- [ ] **Step 4:** `npx vitest run tests/unit/hmac.test.ts tests/unit/auth.test.ts tests/unit/ssrf.test.ts` → PASS. Fix any IP-range test failures by correcting the range, not the test.
- [ ] **Step 5: Commit** — `feat: add HMAC, API key and SSRF security primitives`.

---

### Task 5: Database schema, repositories and job state machine

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/repositories/{apiKeys,jobs,webhookDeliveries}.ts`, `src/server/jobs/state.ts`, `drizzle.config.ts`, `scripts/create-api-key.ts`, generated `drizzle/*`
- Test: `tests/unit/jobState.test.ts`

**Interfaces:**
- Consumes: `getConfig()` (Task 3), `generateApiKey`/`hashApiKey` (Task 4), `JobStatus` (Task 2)
- Produces:
  - `canTransition(from: JobStatus, to: JobStatus): boolean`, `assertTransition(from, to): void` (throws `AppError("CONFLICT",409,…)`)
  - `getDb()`; tables `apiKeys, assets, jobs, webhookDeliveries`
  - `type JobRow = typeof jobs.$inferSelect`
  - `apiKeysRepo.findActiveByHash(hash: string): Promise<{ id: string; name: string } | undefined>`, `apiKeysRepo.create(args: { name: string; keyHash: string }): Promise<{ id: string }>`
  - `jobsRepo.create(args: { ownerId: string; queue: string; type: string; input: Record<string, unknown>; webhookUrl?: string }): Promise<JobRow>`
  - `jobsRepo.get(id: string): Promise<JobRow | undefined>`, `jobsRepo.getForOwner(id: string, ownerId: string): Promise<JobRow | undefined>`
  - `jobsRepo.transition(id: string, to: JobStatus, patch?: { progress?: number; result?: Record<string, unknown>; errorCode?: string; errorMessage?: string }): Promise<JobRow>`
  - `jobsRepo.setProgress(id: string, progress: number): Promise<void>`
  - `webhookDeliveriesRepo.record(args: { eventId: string; jobId: string; url: string; attempt: number; statusCode?: number; error?: string }): Promise<void>`

- [ ] **Step 1: Failing test** `tests/unit/jobState.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "@/server/jobs/state";

describe("job state machine", () => {
  it.each([
    ["queued", "running"], ["running", "succeeded"], ["running", "failed"],
    ["running", "cancelled"], ["queued", "cancelled"], ["running", "queued"], ["queued", "failed"],
  ] as const)("allows %s -> %s", (a, b) => expect(canTransition(a, b)).toBe(true));
  it.each([
    ["succeeded", "running"], ["failed", "queued"], ["cancelled", "running"], ["queued", "succeeded"],
  ] as const)("blocks %s -> %s", (a, b) => expect(canTransition(a, b)).toBe(false));
  it("assertTransition throws CONFLICT on invalid moves", () => {
    expect(() => assertTransition("succeeded", "running")).toThrowError(/succeeded/);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

`src/server/jobs/state.ts`:
```ts
import type { JobStatus } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";

const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled", "queued"], // running -> queued is a retry
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError("CONFLICT", 409, `Invalid job transition ${from} -> ${to}`);
  }
}
```
`src/server/db/schema.ts`:
```ts
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => apiKeys.id),
  key: text("key").notNull().unique(),
  kind: text("kind", { enum: ["video", "image", "output"] }).notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => apiKeys.id),
    queue: text("queue").notNull(),
    type: text("type").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] })
      .notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    webhookUrl: text("webhook_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_owner_idx").on(t.ownerId)],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  url: text("url").notNull(),
  attempt: integer("attempt").notNull(),
  statusCode: integer("status_code"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```
`src/server/db/client.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/server/config";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazy so importing this module never opens a connection (keeps tests and builds side-effect free). */
export function getDb() {
  db ??= drizzle(postgres(getConfig().databaseUrl, { max: 10 }), { schema });
  return db;
}
```
`src/server/db/repositories/apiKeys.ts`:
```ts
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { apiKeys } from "../schema";

export const apiKeysRepo = {
  async findActiveByHash(hash: string) {
    const [row] = await getDb()
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row;
  },
  async create(args: { name: string; keyHash: string }) {
    const [row] = await getDb().insert(apiKeys).values(args).returning({ id: apiKeys.id });
    return row;
  },
};
```
`src/server/db/repositories/jobs.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { JobStatus } from "@/lib/schemas/job";
import { AppError } from "@/server/http/errors";
import { assertTransition } from "@/server/jobs/state";
import { getDb } from "../client";
import { jobs } from "../schema";

export type JobRow = typeof jobs.$inferSelect;

export interface TransitionPatch {
  progress?: number;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

const TERMINAL: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export const jobsRepo = {
  async create(args: {
    ownerId: string; queue: string; type: string;
    input: Record<string, unknown>; webhookUrl?: string;
  }): Promise<JobRow> {
    const [row] = await getDb().insert(jobs).values(args).returning();
    return row;
  },
  async get(id: string): Promise<JobRow | undefined> {
    const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return row;
  },
  async getForOwner(id: string, ownerId: string): Promise<JobRow | undefined> {
    const [row] = await getDb().select().from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.ownerId, ownerId))).limit(1);
    return row;
  },
  /** Compare-and-set on the current status so concurrent workers cannot both win. */
  async transition(id: string, to: JobStatus, patch: TransitionPatch = {}): Promise<JobRow> {
    const current = await jobsRepo.get(id);
    if (!current) throw new AppError("NOT_FOUND", 404, "Job not found");
    assertTransition(current.status, to);
    const [row] = await getDb().update(jobs)
      .set({
        status: to,
        updatedAt: new Date(),
        finishedAt: TERMINAL.includes(to) ? new Date() : null,
        ...(patch.progress !== undefined && { progress: patch.progress }),
        ...(patch.result !== undefined && { result: patch.result }),
        ...(patch.errorCode !== undefined && { errorCode: patch.errorCode }),
        ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
      })
      .where(and(eq(jobs.id, id), eq(jobs.status, current.status)))
      .returning();
    if (!row) throw new AppError("CONFLICT", 409, "Job state changed concurrently");
    return row;
  },
  async setProgress(id: string, progress: number): Promise<void> {
    await getDb().update(jobs).set({ progress, updatedAt: new Date() }).where(eq(jobs.id, id));
  },
};
```
`src/server/db/repositories/webhookDeliveries.ts`:
```ts
import { getDb } from "../client";
import { webhookDeliveries } from "../schema";

export const webhookDeliveriesRepo = {
  async record(args: {
    eventId: string; jobId: string; url: string; attempt: number;
    statusCode?: number; error?: string;
  }): Promise<void> {
    await getDb().insert(webhookDeliveries).values(args);
  },
};
```
`drizzle.config.ts` (tooling config; reads env directly by design):
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```
`scripts/create-api-key.ts`:
```ts
import { getConfig } from "../src/server/config";
import { apiKeysRepo } from "../src/server/db/repositories/apiKeys";
import { generateApiKey, hashApiKey } from "../src/server/security/auth";

const name = process.argv[2] ?? "default";
const key = generateApiKey();
const { id } = await apiKeysRepo.create({ name, keyHash: hashApiKey(key, getConfig().apiKeyPepper) });
console.log(`Created API key "${name}" (id ${id}). Store it now, it cannot be shown again:\n${key}`);
process.exit(0);
```
(Scripts use relative imports because `tsx` does not apply the Next `@/` alias unless `tsconfig` paths are honoured; `tsx` does honour `tsconfig.json` `paths`, so `@/` also works in `worker/` — verify in Task 8 and keep whichever style works consistently.)

- [ ] **Step 4: Generate and apply migration; verify**
```powershell
npx vitest run tests/unit/jobState.test.ts
npm run db:generate
npm run db:migrate
npm run create-key -- local-dev
```
Expected: test PASS; `drizzle/0000_*.sql` created; migrate succeeds; script prints an `ak_…` key (save it in your own notes, not in git). Verify with `docker compose exec postgres psql -U autoclip -c "\dt"` listing the four tables.
- [ ] **Step 5: Commit** — `feat: add database schema, repositories and job state machine` (include `drizzle/`).

---

### Task 6: Queue, storage and webhook delivery

**Files:**
- Create: `src/server/queue/queues.ts`, `src/server/storage/{s3,keys,presign}.ts`, `src/server/webhooks/deliver.ts`
- Test: `tests/unit/storageKeys.test.ts`, `tests/unit/webhookDeliver.test.ts`

**Interfaces:**
- Consumes: `getConfig`, `jobsRepo`, `AppError`, `signPayload`, `assertPublicUrl`, `JobData`
- Produces:
  - `QUEUE_NAMES = ["video-analyze","video-render","collage"] as const`, `type QueueName`
  - `getRedis(): IORedis`, `getQueue(name: QueueName): Queue<JobData>`
  - `enqueueJob(args: { queue: QueueName; type: string; ownerId: string; input: Record<string, unknown>; webhookUrl?: string }): Promise<JobRow>`
  - `buildUploadKey(args: { ownerId: string; uploadId: string; filename: string }): string` → `uploads/{ownerId}/{uploadId}/{sanitized}`; `sanitizeFilename(name: string): string`
  - `presignPut(args: { key: string; contentType: string; sizeBytes: number }): Promise<{ url: string; expiresInSec: number }>`, `presignGet(key: string): Promise<string>`, `objectExists(key: string): Promise<boolean>`
  - `WebhookEvent = { eventId: string; jobId: string; type: string; status: JobStatus; resultUrls: string[] }`
  - `deliverWebhook(args: { url: string; event: WebhookEvent }, deps?: WebhookDeps): Promise<boolean>` with `WebhookDeps = { fetch; sleep(ms): Promise<void>; secret: string; maxAttempts: number; baseDelayMs: number; nowSec(): number; assertUrl(url: string): Promise<unknown>; record(a: { eventId: string; jobId: string; url: string; attempt: number; statusCode?: number; error?: string }): Promise<void> }`

- [ ] **Step 1: Failing tests**

`tests/unit/storageKeys.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildUploadKey, sanitizeFilename } from "@/server/storage/keys";

describe("storage keys", () => {
  it("strips path separators and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/pass wd?.mp4")).toBe("pass_wd_.mp4");
  });
  it("falls back for empty names and caps length", () => {
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("a".repeat(500) + ".mp4").length).toBeLessThanOrEqual(120);
  });
  it("builds namespaced keys", () => {
    expect(buildUploadKey({ ownerId: "o", uploadId: "u", filename: "a b.png" })).toBe("uploads/o/u/a_b.png");
  });
});
```
`tests/unit/webhookDeliver.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { deliverWebhook, type WebhookDeps } from "@/server/webhooks/deliver";
import { verifySignature } from "@/server/security/hmac";

const event = { eventId: "e1", jobId: "j1", type: "collage.build", status: "succeeded" as const, resultUrls: [] };
const secret = "s".repeat(32);

function deps(responses: Array<Response | Error>): WebhookDeps & { sleeps: number[]; records: unknown[]; fetchMock: ReturnType<typeof vi.fn> } {
  const sleeps: number[] = [];
  const records: unknown[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    fetch: fetchMock as unknown as WebhookDeps["fetch"],
    sleep: async (ms) => { sleeps.push(ms); },
    secret, maxAttempts: 3, baseDelayMs: 100, nowSec: () => 1000,
    assertUrl: async () => undefined,
    record: async (r) => { records.push(r); },
    sleeps, records, fetchMock,
  };
}

describe("deliverWebhook", () => {
  it("sends a verifiable signed request and records the attempt", async () => {
    const d = deps([new Response("ok", { status: 200 })]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(true);
    const [, init] = d.fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(verifySignature({
      secret, body: init.body as string, signature: headers["X-Signature"],
      timestamp: Number(headers["X-Timestamp"]), toleranceSec: 300, nowSec: 1000,
    })).toBe(true);
    expect(d.records).toEqual([expect.objectContaining({ attempt: 1, statusCode: 200, eventId: "e1" })]);
  });
  it("retries with exponential backoff then succeeds", async () => {
    const d = deps([new Response("", { status: 500 }), new Error("boom"), new Response("ok", { status: 204 })]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(true);
    expect(d.sleeps).toEqual([100, 200]);
    expect(d.records).toHaveLength(3);
  });
  it("gives up after maxAttempts and returns false", async () => {
    const d = deps([new Response("", { status: 500 }), new Response("", { status: 500 }), new Response("", { status: 500 })]);
    expect(await deliverWebhook({ url: "https://hook.test/x", event }, d)).toBe(false);
    expect(d.records).toHaveLength(3);
  });
  it("does not send when the URL fails the SSRF check", async () => {
    const d = deps([]);
    d.assertUrl = async () => { throw new Error("blocked"); };
    expect(await deliverWebhook({ url: "http://127.0.0.1/", event }, d)).toBe(false);
    expect(d.fetchMock).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

`src/server/storage/keys.ts`:
```ts
const MAX_NAME_LEN = 120;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return cleaned.slice(-MAX_NAME_LEN) || "file";
}

export function buildUploadKey(args: { ownerId: string; uploadId: string; filename: string }): string {
  return `uploads/${args.ownerId}/${args.uploadId}/${sanitizeFilename(args.filename)}`;
}
```
Check: `"../../etc/pass wd?.mp4"` → base `pass wd?.mp4` → `pass_wd_.mp4` ✓; `"///"` → base `""` → `file` ✓.

`src/server/storage/s3.ts`:
```ts
import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@/server/config";

let client: S3Client | undefined;

export function getS3(): S3Client {
  const { s3 } = getConfig();
  client ??= new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: true, // MinIO needs path-style addressing
    credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
  });
  return client;
}
```
`src/server/storage/presign.ts`:
```ts
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "@/server/config";
import { getS3 } from "./s3";

export async function presignPut(args: { key: string; contentType: string; sizeBytes: number }) {
  const { s3, presignTtlSec } = getConfig();
  const url = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: s3.bucket, Key: args.key,
      ContentType: args.contentType, ContentLength: args.sizeBytes,
    }),
    { expiresIn: presignTtlSec },
  );
  return { url, expiresInSec: presignTtlSec };
}

export async function presignGet(key: string): Promise<string> {
  const { s3, presignTtlSec } = getConfig();
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: s3.bucket, Key: key }), {
    expiresIn: presignTtlSec,
  });
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: getConfig().s3.bucket, Key: key }));
    return true;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}
```
`src/server/queue/queues.ts`:
```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JobData } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { jobsRepo, type JobRow } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";

export const QUEUE_NAMES = ["video-analyze", "video-render", "collage"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

let redis: IORedis | undefined;
/** BullMQ requires `maxRetriesPerRequest: null` for blocking worker connections. */
export function getRedis(): IORedis {
  redis ??= new IORedis(getConfig().redisUrl, { maxRetriesPerRequest: null });
  return redis;
}

const queues = new Map<QueueName, Queue<JobData>>();
export function getQueue(name: QueueName): Queue<JobData> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue<JobData>(name, { connection: getRedis() });
    queues.set(name, q);
  }
  return q;
}

export const JOB_ATTEMPTS = 3;

/** Persists the job row first, then enqueues with the row id as the BullMQ jobId (idempotent). */
export async function enqueueJob(args: {
  queue: QueueName; type: string; ownerId: string;
  input: Record<string, unknown>; webhookUrl?: string;
}): Promise<JobRow> {
  const row = await jobsRepo.create(args);
  try {
    await getQueue(args.queue).add(args.type, { jobId: row.id, type: args.type }, {
      jobId: row.id,
      attempts: JOB_ATTEMPTS,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  } catch {
    await jobsRepo.transition(row.id, "failed", {
      errorCode: "QUEUE_UNAVAILABLE", errorMessage: "Could not enqueue job",
    });
    throw new AppError("QUEUE_UNAVAILABLE", 503, "Queue is unavailable");
  }
  return row;
}
```
`src/server/webhooks/deliver.ts`:
```ts
import type { JobStatus } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { webhookDeliveriesRepo } from "@/server/db/repositories/webhookDeliveries";
import { signPayload } from "@/server/security/hmac";
import { assertPublicUrl } from "@/server/security/ssrf";

export interface WebhookEvent {
  eventId: string;
  jobId: string;
  type: string;
  status: JobStatus;
  resultUrls: string[];
}

export interface WebhookDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  secret: string;
  maxAttempts: number;
  baseDelayMs: number;
  nowSec: () => number;
  assertUrl: (url: string) => Promise<unknown>;
  record: (a: {
    eventId: string; jobId: string; url: string; attempt: number; statusCode?: number; error?: string;
  }) => Promise<void>;
}

export function defaultWebhookDeps(): WebhookDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    secret: getConfig().webhookSecret,
    maxAttempts: 5,
    baseDelayMs: 1000,
    nowSec: () => Math.floor(Date.now() / 1000),
    assertUrl: (url) => assertPublicUrl(url),
    record: (a) => webhookDeliveriesRepo.record(a),
  };
}

/** Returns true on a 2xx response. Never throws: callers must not fail a job because a receiver is down. */
export async function deliverWebhook(
  args: { url: string; event: WebhookEvent },
  deps: WebhookDeps = defaultWebhookDeps(),
): Promise<boolean> {
  try {
    await deps.assertUrl(args.url);
  } catch {
    return false;
  }
  const body = JSON.stringify(args.event);
  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    const timestamp = deps.nowSec();
    const rec = { eventId: args.event.eventId, jobId: args.event.jobId, url: args.url, attempt };
    try {
      const res = await deps.fetch(args.url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": String(timestamp),
          "X-Signature": signPayload({ secret: deps.secret, body, timestamp }),
        },
        body,
      });
      await deps.record({ ...rec, statusCode: res.status });
      if (res.ok) return true;
    } catch (err) {
      await deps.record({ ...rec, error: err instanceof Error ? err.message : "request failed" });
    }
    if (attempt < deps.maxAttempts) await deps.sleep(deps.baseDelayMs * 2 ** (attempt - 1));
  }
  return false;
}
```
- [ ] **Step 4:** `npx vitest run tests/unit/storageKeys.test.ts tests/unit/webhookDeliver.test.ts` → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `feat: add queue, storage helpers and webhook delivery`.

---

### Task 7: `withApi` and the three routes

**Files:**
- Create: `src/server/http/withApi.ts`, `src/server/security/principal.ts`, `src/app/api/health/route.ts`, `src/app/api/uploads/presign/route.ts`, `src/app/api/jobs/[id]/route.ts`
- Test: `tests/unit/withApi.test.ts`, `tests/integration/routes.test.ts`

**Interfaces:**
- Consumes: `AppError`, `errorBody`, `ApiResult`, `apiKeysRepo`, `jobsRepo`, `hashApiKey`, `parseBearer`, `PresignBody`, `buildUploadKey`, `presignPut`, `getConfig`, `JobResponse`
- Produces:
  - `type Principal = { id: string; name: string }`; `authenticateApiKey(req: Request): Promise<Principal>`
  - `createWithApi(deps: { authenticate(req: Request): Promise<Principal>; logger: { info(o: object, m?: string): void; error(o: object, m?: string): void } })` returning `withApi`
  - `withApi({ auth: "apiKey" | "none", body?: ZodType, query?: ZodType }, handler)`; handler receives `{ body, query, params, ctx: { principal: Principal | null; requestId: string } }` and returns `ApiResult`
  - `requirePrincipal(ctx): Principal` (throws `UNAUTHORIZED` if null)

- [ ] **Step 1: Failing tests**

`tests/unit/withApi.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/server/http/errors";
import { createWithApi, requirePrincipal } from "@/server/http/withApi";

const logger = { info: () => undefined, error: () => undefined };
const principal = { id: "p1", name: "test" };
const make = (authenticate = async () => principal) => createWithApi({ authenticate, logger });
const post = (body: string) => new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("withApi", () => {
  it("validates the body and returns handler json with status", async () => {
    const withApi = make();
    const h = withApi({ auth: "apiKey", body: z.object({ n: z.number() }) }, async ({ body, ctx }) => ({
      status: 202, json: { n: body.n, owner: requirePrincipal(ctx).id },
    }));
    const res = await h(post('{"n":3}'));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ n: 3, owner: "p1" });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
  it("returns VALIDATION_FAILED for bad bodies and invalid JSON", async () => {
    const h = make()({ auth: "apiKey", body: z.object({ n: z.number() }) }, async () => ({ json: {} }));
    for (const raw of ['{"n":"x"}', "not json"]) {
      const res = await h(post(raw));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
  });
  it("returns UNAUTHORIZED when authentication fails and skips the handler", async () => {
    let called = false;
    const h = make(async () => { throw new AppError("UNAUTHORIZED", 401, "no"); })(
      { auth: "apiKey" }, async () => { called = true; return { json: {} }; });
    const res = await h(new Request("http://x/api"));
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });
  it("does not authenticate when auth is none", async () => {
    const h = make(async () => { throw new Error("should not run"); })({ auth: "none" }, async () => ({ json: { ok: true } }));
    expect((await h(new Request("http://x/api"))).status).toBe(200);
  });
  it("maps unexpected errors to a generic 500", async () => {
    const h = make()({ auth: "none" }, async () => { throw new Error("secret detail"); });
    const res = await h(new Request("http://x/api"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
  it("parses query strings and awaits route params", async () => {
    const h = make()({ auth: "none", query: z.object({ limit: z.coerce.number() }) },
      async ({ query, params }) => ({ json: { limit: query.limit, id: params.id } }));
    const res = await h(new Request("http://x/api?limit=5"), { params: Promise.resolve({ id: "abc" }) });
    expect(await res.json()).toEqual({ limit: 5, id: "abc" });
  });
});
```
`tests/integration/routes.test.ts` (handlers run against mocked repositories; no Docker needed):
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = {
  DATABASE_URL: "postgres://u:p@localhost/d", REDIS_URL: "redis://localhost",
  S3_ENDPOINT: "http://localhost:9000", S3_REGION: "us-east-1", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s", S3_BUCKET: "b",
  API_KEY_PEPPER: "p".repeat(16), WEBHOOK_SIGNING_SECRET: "w".repeat(16), MAX_UPLOAD_MB: "1",
};
Object.assign(process.env, env);

const findActiveByHash = vi.fn();
const getForOwner = vi.fn();
vi.mock("@/server/db/repositories/apiKeys", () => ({ apiKeysRepo: { findActiveByHash } }));
vi.mock("@/server/db/repositories/jobs", () => ({ jobsRepo: { getForOwner } }));
vi.mock("@/server/storage/presign", () => ({
  presignPut: async () => ({ url: "http://minio/put?sig=abc", expiresInSec: 900 }),
}));

const auth = { Authorization: "Bearer ak_test" };

beforeEach(() => {
  findActiveByHash.mockReset().mockResolvedValue({ id: "11111111-1111-1111-1111-111111111111", name: "t" });
  getForOwner.mockReset();
});

describe("POST /api/uploads/presign", () => {
  const call = async (body: unknown, headers: Record<string, string> = auth) => {
    const { POST } = await import("@/app/api/uploads/presign/route");
    return POST(new Request("http://x/api/uploads/presign", { method: "POST", headers, body: JSON.stringify(body) }));
  };
  it("rejects missing credentials", async () => {
    expect((await call({}, {})).status).toBe(401);
  });
  it("returns a presigned URL and a namespaced key", async () => {
    const res = await call({ filename: "My Clip.mp4", contentType: "video/mp4", sizeBytes: 1000 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toContain("http://minio/put");
    expect(json.key).toMatch(/^uploads\/1111.*\/My_Clip\.mp4$/);
  });
  it("rejects files above MAX_UPLOAD_MB", async () => {
    const res = await call({ filename: "big.mp4", contentType: "video/mp4", sizeBytes: 5 * 1024 * 1024 });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/jobs/:id", () => {
  const id = "22222222-2222-2222-2222-222222222222";
  const call = async (jobId: string) => {
    const { GET } = await import("@/app/api/jobs/[id]/route");
    return GET(new Request("http://x/api/jobs/" + jobId, { headers: auth }), { params: Promise.resolve({ id: jobId }) });
  };
  it("returns the job for its owner", async () => {
    getForOwner.mockResolvedValue({ id, type: "collage.build", status: "running", progress: 40, result: null, errorCode: null, errorMessage: null });
    const res = await call(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "running", progress: 40, error: null });
  });
  it("404s for unknown or non-uuid ids", async () => {
    getForOwner.mockResolvedValue(undefined);
    expect((await call(id)).status).toBe(404);
    expect((await call("not-a-uuid")).status).toBe(404);
  });
  it("surfaces failure details", async () => {
    getForOwner.mockResolvedValue({ id, type: "t", status: "failed", progress: 10, result: null, errorCode: "JOB_FAILED", errorMessage: "boom" });
    expect((await (await call(id)).json()).error).toEqual({ code: "JOB_FAILED", message: "boom" });
  });
});
```
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement**

`src/server/security/principal.ts`:
```ts
import { getConfig } from "@/server/config";
import { apiKeysRepo } from "@/server/db/repositories/apiKeys";
import { AppError } from "@/server/http/errors";
import { hashApiKey, parseBearer } from "./auth";

export interface Principal {
  id: string;
  name: string;
}

export async function authenticateApiKey(req: Request): Promise<Principal> {
  const key = parseBearer(req.headers.get("authorization"));
  if (!key) throw new AppError("UNAUTHORIZED", 401, "Missing API key");
  const row = await apiKeysRepo.findActiveByHash(hashApiKey(key, getConfig().apiKeyPepper));
  if (!row) throw new AppError("UNAUTHORIZED", 401, "Invalid API key");
  return row;
}
```
`src/server/http/withApi.ts`:
```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import { logger } from "@/server/logger";
import { authenticateApiKey, type Principal } from "@/server/security/principal";
import { AppError, errorBody } from "./errors";
import type { ApiResult } from "./responses";

export interface ApiContext {
  principal: Principal | null;
  requestId: string;
}

export interface ApiDeps {
  authenticate(req: Request): Promise<Principal>;
  logger: { info(o: object, m?: string): void; error(o: object, m?: string): void };
}

export function requirePrincipal(ctx: ApiContext): Principal {
  if (!ctx.principal) throw new AppError("UNAUTHORIZED", 401, "Authentication required");
  return ctx.principal;
}

type RouteCtx = { params?: Promise<Record<string, string>> };

function parseOrThrow<T extends ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AppError("VALIDATION_FAILED", 400, `Invalid ${what}`, { issues });
  }
  return r.data;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", 400, "Invalid JSON body");
  }
}

export function createWithApi(deps: ApiDeps) {
  return function withApi<B extends ZodType = ZodType<undefined>, Q extends ZodType = ZodType<undefined>>(
    opts: { auth: "apiKey" | "none"; body?: B; query?: Q },
    handler: (a: {
      body: z.infer<B>; query: z.infer<Q>; params: Record<string, string>; ctx: ApiContext;
    }) => Promise<ApiResult>,
  ) {
    return async (req: Request, route?: RouteCtx): Promise<Response> => {
      const requestId = randomUUID();
      const started = Date.now();
      let status = 500;
      try {
        const principal = opts.auth === "apiKey" ? await deps.authenticate(req) : null;
        const query = opts.query
          ? parseOrThrow(opts.query, Object.fromEntries(new URL(req.url).searchParams), "query")
          : undefined;
        const body = opts.body ? parseOrThrow(opts.body, await readJson(req), "body") : undefined;
        const params = (await route?.params) ?? {};
        const result = await handler({ body, query, params, ctx: { principal, requestId } });
        status = result.status ?? 200;
        return Response.json(result.json, { status, headers: { "x-request-id": requestId } });
      } catch (err) {
        const e = errorBody(err);
        status = e.status;
        if (e.status >= 500) deps.logger.error({ requestId, err }, "request failed");
        return Response.json(e.body, { status: e.status, headers: { "x-request-id": requestId } });
      } finally {
        deps.logger.info({ requestId, method: req.method, path: new URL(req.url).pathname, status, ms: Date.now() - started }, "request");
      }
    };
  };
}

export const withApi = createWithApi({ authenticate: authenticateApiKey, logger });
```
`src/app/api/uploads/presign/route.ts`:
```ts
import { randomUUID } from "node:crypto";
import { PresignBody, type PresignResponse } from "@/lib/schemas/api";
import { getConfig } from "@/server/config";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";
import { buildUploadKey } from "@/server/storage/keys";
import { presignPut } from "@/server/storage/presign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi({ auth: "apiKey", body: PresignBody }, async ({ body, ctx }) => {
  const { maxUploadBytes } = getConfig();
  if (body.sizeBytes > maxUploadBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", 413, "File exceeds the maximum upload size", { maxBytes: maxUploadBytes });
  }
  const key = buildUploadKey({
    ownerId: requirePrincipal(ctx).id, uploadId: randomUUID(), filename: body.filename,
  });
  const { url, expiresInSec } = await presignPut({ key, contentType: body.contentType, sizeBytes: body.sizeBytes });
  const json: PresignResponse = { url, key, expiresInSec };
  return { json };
});
```
`src/app/api/jobs/[id]/route.ts`:
```ts
import { z } from "zod";
import type { JobResponse } from "@/lib/schemas/job";
import { jobsRepo } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { requirePrincipal, withApi } from "@/server/http/withApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdParam = z.string().uuid();

export const GET = withApi({ auth: "apiKey" }, async ({ params, ctx }) => {
  const id = IdParam.safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND", 404, "Job not found");
  const job = await jobsRepo.getForOwner(id.data, requirePrincipal(ctx).id);
  if (!job) throw new AppError("NOT_FOUND", 404, "Job not found");
  const json: JobResponse = {
    id: job.id, type: job.type, status: job.status, progress: job.progress, result: job.result ?? null,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage ?? "" } : null,
  };
  return { json };
});
```
`src/app/api/health/route.ts`:
```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { withApi } from "@/server/http/withApi";
import { getRedis } from "@/server/queue/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 2000;

async function check(name: string, fn: () => Promise<unknown>): Promise<[string, boolean]> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), CHECK_TIMEOUT_MS)),
    ]);
    return [name, true];
  } catch {
    return [name, false];
  }
}

export const GET = withApi({ auth: "none" }, async () => {
  const checks = Object.fromEntries(
    await Promise.all([
      check("db", () => getDb().execute(sql`select 1`)),
      check("redis", () => getRedis().ping()),
    ]),
  );
  if (Object.values(checks).some((ok) => !ok)) {
    throw new AppError("DEPENDENCY_UNAVAILABLE", 503, "A dependency is unavailable", { checks });
  }
  return { json: { status: "ok", checks } };
});
```
Verify against the installed Next.js: the second route argument must type-check as `{ params: Promise<{ id: string }> }`. If `tsc` complains in `.next/types`, widen `RouteCtx.params` generics (e.g. `Promise<Record<string, string | string[] | undefined>>`) and adapt `params` normalization in `withApi` accordingly.

- [ ] **Step 4:** `npx vitest run tests/unit/withApi.test.ts tests/integration/routes.test.ts` → PASS; `npm run typecheck`; `npm run build` succeeds (catches Next route typing).
- [ ] **Step 5: Commit** — `feat: add withApi wrapper and health, presign, job routes`.

---

### Task 8: FFmpeg helpers

**Files:**
- Create: `src/server/renderers/ffmpeg.ts`, `src/server/renderers/ffprobe.ts`
- Test: `tests/unit/ffmpeg.test.ts`, `tests/integration/ffmpeg.test.ts`

**Interfaces:**
- Produces:
  - `runFfmpeg(args: string[], opts: { timeoutMs: number; signal?: AbortSignal }): Promise<void>`
  - `escapeFilterText(text: string): string` (escapes for use inside an FFmpeg filter option value)
  - `probeMedia(path: string, opts?: { timeoutMs?: number }): Promise<MediaInfo>`; `parseProbe(json: unknown): MediaInfo`
  - `MediaInfo = { durationSec: number; hasVideo: boolean; hasAudio: boolean; width?: number; height?: number; fps?: number }`

- [ ] **Step 1: Failing tests**

`tests/unit/ffmpeg.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { escapeFilterText } from "@/server/renderers/ffmpeg";
import { parseProbe } from "@/server/renderers/ffprobe";

describe("escapeFilterText", () => {
  it("escapes characters significant to filter graphs", () => {
    expect(escapeFilterText("a:b'c,d;e[f]g\\h")).toBe("a\\:b\\'c\\,d\\;e\\[f\\]g\\\\h");
  });
  it("leaves plain text alone", () => {
    expect(escapeFilterText("Hello world")).toBe("Hello world");
  });
});

describe("parseProbe", () => {
  const json = {
    format: { duration: "2.500000" },
    streams: [
      { codec_type: "video", width: 320, height: 240, avg_frame_rate: "30/1" },
      { codec_type: "audio" },
    ],
  };
  it("extracts duration, dimensions, fps and stream presence", () => {
    expect(parseProbe(json)).toEqual({ durationSec: 2.5, hasVideo: true, hasAudio: true, width: 320, height: 240, fps: 30 });
  });
  it("handles images/no audio and 0/0 frame rates", () => {
    const info = parseProbe({ format: {}, streams: [{ codec_type: "video", width: 10, height: 10, avg_frame_rate: "0/0" }] });
    expect(info).toMatchObject({ hasVideo: true, hasAudio: false, durationSec: 0 });
    expect(info.fps).toBeUndefined();
  });
  it("throws on malformed output", () => {
    expect(() => parseProbe({ nope: true })).toThrow();
  });
});
```
`tests/integration/ffmpeg.test.ts` (uses the locally installed ffmpeg/ffprobe):
```ts
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFfmpeg } from "@/server/renderers/ffmpeg";
import { probeMedia } from "@/server/renderers/ffprobe";

describe("ffmpeg integration", () => {
  it("renders a tiny clip and probes it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ffmpeg-test-"));
    try {
      const out = path.join(dir, "t.mp4");
      await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1", "-pix_fmt", "yuv420p", out], { timeoutMs: 30_000 });
      expect((await stat(out)).size).toBeGreaterThan(0);
      const info = await probeMedia(out);
      expect(info).toMatchObject({ hasVideo: true, width: 160, height: 120 });
      expect(info.durationSec).toBeGreaterThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects with stderr tail on failure", async () => {
    await expect(runFfmpeg(["-i", "does-not-exist.mp4", "-f", "null", "-"], { timeoutMs: 10_000 })).rejects.toThrow(/ffmpeg exited/);
  });
  it("kills the process on timeout", async () => {
    await expect(runFfmpeg(["-f", "lavfi", "-i", "testsrc=duration=600", "-f", "null", "-"], { timeoutMs: 200 })).rejects.toThrow();
  });
});
```
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement**

`src/server/renderers/ffmpeg.ts`:
```ts
import { spawn } from "node:child_process";

const STDERR_TAIL_BYTES = 8000;

/** Runs ffmpeg with an argument array (never a shell string). Rejects with the stderr tail on failure. */
export function runFfmpeg(args: string[], opts: { timeoutMs: number; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-y", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    p.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-STDERR_TAIL_BYTES);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", () => p.kill("SIGKILL"), { once: true });
    p.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(timedOut ? `ffmpeg timed out after ${opts.timeoutMs}ms` : `ffmpeg exited ${code}: ${stderr}`));
    });
  });
}

/** Escapes text for use as a filter option value (drawtext, subtitles paths, etc.). */
export function escapeFilterText(text: string): string {
  return text.replace(/[\\:'",;[\]=]/g, (c) => `\\${c}`);
}
```
Check against the unit test: input `a:b'c,d;e[f]g\h` expects `a\:b\'c\,d\;e\[f\]g\\h`; the regex above also escapes `"` and `=` (not in the test input) — fine.

`src/server/renderers/ffprobe.ts`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const ProbeSchema = z.object({
  format: z.object({ duration: z.string().optional() }),
  streams: z.array(z.object({
    codec_type: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    avg_frame_rate: z.string().optional(),
  })),
});

export interface MediaInfo {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

function parseFps(rate?: string): number | undefined {
  const [n, d] = (rate ?? "").split("/").map(Number);
  return n > 0 && d > 0 ? n / d : undefined;
}

export function parseProbe(json: unknown): MediaInfo {
  const p = ProbeSchema.parse(json);
  const video = p.streams.find((s) => s.codec_type === "video");
  return {
    durationSec: Number(p.format.duration ?? 0),
    hasVideo: Boolean(video),
    hasAudio: p.streams.some((s) => s.codec_type === "audio"),
    width: video?.width,
    height: video?.height,
    fps: parseFps(video?.avg_frame_rate),
  };
}

/** `execFile` passes args as an array with no shell, so paths cannot inject options after `--`. */
export async function probeMedia(path: string, opts: { timeoutMs?: number } = {}): Promise<MediaInfo> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", path],
    { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 10 * 1024 * 1024 },
  );
  return parseProbe(JSON.parse(stdout));
}
```
If `ffprobe` rejects `--`, drop it and instead pass `["-i", path]`-style via `file:` prefix (`` `file:${path}` ``); verify by running the integration test.

- [ ] **Step 4:** `npx vitest run tests/unit/ffmpeg.test.ts tests/integration/ffmpeg.test.ts` → PASS. The new PATH may need refreshing so `ffmpeg` resolves (it is installed under WinGet).
- [ ] **Step 5: Commit** — `feat: add ffmpeg and ffprobe helpers`.

---

### Task 9: Worker bootstrap and job runner

**Files:**
- Create: `worker/runJob.ts`, `worker/processors/placeholder.ts`, `worker/index.ts`
- Test: `tests/unit/runJob.test.ts`

**Interfaces:**
- Consumes: `jobsRepo`, `deliverWebhook`, `AppError`, `getQueue/getRedis/QUEUE_NAMES`, `JobData`, `JOB_ATTEMPTS`
- Produces:
  - `type JobStore = { get(id: string): Promise<JobRow | undefined>; transition(id: string, to: JobStatus, patch?: TransitionPatch): Promise<JobRow>; setProgress(id: string, p: number): Promise<void> }`
  - `runJob(args: { jobId: string; attemptsMade: number; maxAttempts: number }, work: (ctx: { job: JobRow; progress(p: number): Promise<void> }) => Promise<Record<string, unknown>>, deps?: RunJobDeps): Promise<void>` with `RunJobDeps = { store: JobStore; notify(job: JobRow, status: JobStatus): Promise<void> }`
  - `processors: Record<QueueName, (job: Job<JobData>) => Promise<void>>`

- [ ] **Step 1: Failing test** `tests/unit/runJob.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/http/errors";
import { runJob, type RunJobDeps } from "../../worker/runJob";

type Row = { id: string; status: string; webhookUrl: string | null; type: string; progress: number; [k: string]: unknown };

function harness(initial: Partial<Row> = {}) {
  const row: Row = { id: "j1", status: "queued", webhookUrl: null, type: "t", progress: 0, ...initial };
  const history: string[] = [];
  const notify = vi.fn(async () => undefined);
  const deps = {
    store: {
      get: async () => ({ ...row }),
      transition: async (_id: string, to: string, patch: Record<string, unknown> = {}) => {
        history.push(to);
        Object.assign(row, patch, { status: to });
        return { ...row };
      },
      setProgress: async () => undefined,
    },
    notify,
  } as unknown as RunJobDeps;
  return { row, history, notify, deps };
}

const args = { jobId: "j1", attemptsMade: 0, maxAttempts: 3 };

describe("runJob", () => {
  it("runs queued -> running -> succeeded and stores the result", async () => {
    const h = harness();
    await runJob(args, async () => ({ out: 1 }), h.deps);
    expect(h.history).toEqual(["running", "succeeded"]);
    expect(h.row.result).toEqual({ out: 1 });
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "succeeded");
  });
  it("is a no-op for jobs that already finished (idempotent retry)", async () => {
    const h = harness({ status: "succeeded" });
    const work = vi.fn();
    await runJob(args, work, h.deps);
    expect(work).not.toHaveBeenCalled();
    expect(h.history).toEqual([]);
  });
  it("resumes a job left running by a crashed attempt", async () => {
    const h = harness({ status: "running" });
    await runJob(args, async () => ({}), h.deps);
    expect(h.history).toEqual(["succeeded"]);
  });
  it("requeues and rethrows when attempts remain", async () => {
    const h = harness();
    await expect(runJob(args, async () => { throw new Error("x"); }, h.deps)).rejects.toThrow("x");
    expect(h.history).toEqual(["running", "queued"]);
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("fails permanently with the AppError code on the final attempt and notifies", async () => {
    const h = harness();
    const final = { ...args, attemptsMade: 2 };
    await expect(runJob(final, async () => { throw new AppError("VALIDATION_FAILED", 400, "bad input"); }, h.deps)).rejects.toThrow();
    expect(h.history).toEqual(["running", "failed"]);
    expect(h.row).toMatchObject({ errorCode: "VALIDATION_FAILED", errorMessage: "bad input" });
    expect(h.notify).toHaveBeenCalledWith(expect.anything(), "failed");
  });
  it("does not fail the job if notification throws", async () => {
    const h = harness();
    h.notify.mockRejectedValueOnce(new Error("hook down"));
    await expect(runJob(args, async () => ({}), h.deps)).resolves.toBeUndefined();
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

`worker/runJob.ts`:
```ts
import type { JobStatus } from "@/lib/schemas/job";
import { jobsRepo, type JobRow, type TransitionPatch } from "@/server/db/repositories/jobs";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/logger";
import { deliverWebhook } from "@/server/webhooks/deliver";
import { randomUUID } from "node:crypto";

export interface JobStore {
  get(id: string): Promise<JobRow | undefined>;
  transition(id: string, to: JobStatus, patch?: TransitionPatch): Promise<JobRow>;
  setProgress(id: string, progress: number): Promise<void>;
}

export interface RunJobDeps {
  store: JobStore;
  notify(job: JobRow, status: JobStatus): Promise<void>;
}

const defaultDeps: RunJobDeps = {
  store: jobsRepo,
  async notify(job, status) {
    if (!job.webhookUrl) return;
    await deliverWebhook({
      url: job.webhookUrl,
      event: { eventId: randomUUID(), jobId: job.id, type: job.type, status, resultUrls: [] },
    });
  },
};

const FINISHED: readonly string[] = ["succeeded", "failed", "cancelled"];

async function safeNotify(deps: RunJobDeps, job: JobRow, status: JobStatus) {
  try {
    await deps.notify(job, status);
  } catch (err) {
    logger.error({ jobId: job.id, err }, "webhook notification failed");
  }
}

/**
 * Wraps a processor with state persistence and retry semantics. Safe to call repeatedly:
 * finished jobs are skipped and a job left `running` by a crash is resumed.
 */
export async function runJob(
  args: { jobId: string; attemptsMade: number; maxAttempts: number },
  work: (ctx: { job: JobRow; progress(p: number): Promise<void> }) => Promise<Record<string, unknown>>,
  deps: RunJobDeps = defaultDeps,
): Promise<void> {
  const job = await deps.store.get(args.jobId);
  if (!job) throw new AppError("NOT_FOUND", 404, `Job ${args.jobId} not found`);
  if (FINISHED.includes(job.status)) return;
  const running = job.status === "running" ? job : await deps.store.transition(job.id, "running");
  try {
    const result = await work({ job: running, progress: (p) => deps.store.setProgress(job.id, p) });
    const done = await deps.store.transition(job.id, "succeeded", { progress: 100, result });
    await safeNotify(deps, done, "succeeded");
  } catch (err) {
    const isFinal = args.attemptsMade + 1 >= args.maxAttempts;
    if (!isFinal) {
      await deps.store.transition(job.id, "queued");
    } else {
      const failed = await deps.store.transition(job.id, "failed", {
        errorCode: err instanceof AppError ? err.code : "JOB_FAILED",
        errorMessage: err instanceof Error ? err.message : "Job failed",
      });
      await safeNotify(deps, failed, "failed");
    }
    throw err;
  }
}
```
`worker/processors/placeholder.ts`:
```ts
import type { Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { runJob } from "../runJob";

/** Stand-in until the Collage and Video sub-projects register real processors. */
export async function placeholderProcessor(job: Job<JobData>): Promise<void> {
  await runJob(
    { jobId: job.data.jobId, attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts ?? 1 },
    async ({ progress }) => {
      await progress(50);
      return { note: "placeholder processor" };
    },
  );
}
```
`worker/index.ts`:
```ts
import { Worker, type Job } from "bullmq";
import type { JobData } from "@/lib/schemas/job";
import { getConfig } from "@/server/config";
import { logger } from "@/server/logger";
import { QUEUE_NAMES, getRedis, type QueueName } from "@/server/queue/queues";
import { placeholderProcessor } from "./processors/placeholder";

// TODO(milestone-1/collage, milestone-1/video): replace these with real processors.
const processors: Record<QueueName, (job: Job<JobData>) => Promise<void>> = {
  "video-analyze": placeholderProcessor,
  "video-render": placeholderProcessor,
  collage: placeholderProcessor,
};

function concurrencyFor(name: QueueName): number {
  const c = getConfig();
  return name === "video-analyze" ? c.workerConcurrencyAnalyze : c.workerConcurrencyRender;
}

const workers = QUEUE_NAMES.map((name) => {
  const w = new Worker<JobData>(name, processors[name], {
    connection: getRedis(),
    concurrency: concurrencyFor(name),
  });
  w.on("failed", (job, err) => logger.error({ queue: name, jobId: job?.id, err }, "job attempt failed"));
  w.on("completed", (job) => logger.info({ queue: name, jobId: job.id }, "job completed"));
  return w;
});

logger.info({ queues: QUEUE_NAMES }, "worker started");

async function shutdown() {
  logger.info("worker shutting down");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```
If `tsx` cannot resolve the `@/` alias in `worker/`, confirm `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` (create-next-app sets it); `tsx` reads it.

- [ ] **Step 4:** `npx vitest run tests/unit/runJob.test.ts` → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat: add worker bootstrap and idempotent job runner`.

---

### Task 10: Landing page, API docs and end-to-end smoke verification

**Files:**
- Modify: `src/app/page.tsx`
- Create: `docs/api.md`, `README.md` (replace create-next-app's), `scripts/smoke.ts`

**Interfaces:**
- Consumes: everything above. Produces: a verified running system.

- [ ] **Step 1: Landing page** — replace `src/app/page.tsx` with a static Server Component (no env reads) with the app name, a one-line description and a link to `/api/health`:
```tsx
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">AutoClip &amp; Collage Studio</h1>
      <p className="mt-2 text-muted-foreground">
        Self-hosted auto-clipping and collage builder. See <code>docs/api.md</code> for the API.
      </p>
      <a className="mt-4 inline-block underline" href="/api/health">Service health</a>
    </main>
  );
}
```
- [ ] **Step 2: `docs/api.md`** documenting: auth (`Authorization: Bearer <key>`, create with `npm run create-key`), error envelope, and the three routes with request/response examples:
  - `GET /api/health` → `200 {"status":"ok","checks":{"db":true,"redis":true}}` or `503` envelope with `details.checks`.
  - `POST /api/uploads/presign` body `{filename, contentType, sizeBytes}` → `200 {url,key,expiresInSec}`; errors `400`, `401`, `413`. Include a curl example uploading with `curl -X PUT -H "Content-Type: <type>" --data-binary @file "<url>"`.
  - `GET /api/jobs/:id` → `200 {id,type,status,progress,result,error}`; `404`.
  - Webhook contract: headers `X-Signature: sha256=<hex>` and `X-Timestamp`, signature over `${timestamp}.${rawBody}`, payload fields `eventId, jobId, type, status, resultUrls`, dedupe on `eventId`, retries with exponential backoff.
  Update `README.md` with prerequisites (Node LTS, Docker, FFmpeg) and the startup sequence from Step 4.
- [ ] **Step 3: Smoke script** `scripts/smoke.ts` — enqueues a placeholder job directly and polls the DB until it succeeds:
```ts
import { enqueueJob } from "../src/server/queue/queues";
import { jobsRepo } from "../src/server/db/repositories/jobs";
import { apiKeysRepo } from "../src/server/db/repositories/apiKeys";
import { hashApiKey } from "../src/server/security/auth";
import { getConfig } from "../src/server/config";

const key = process.argv[2];
if (!key) throw new Error("usage: npm run smoke -- <api key>");
const owner = await apiKeysRepo.findActiveByHash(hashApiKey(key, getConfig().apiKeyPepper));
if (!owner) throw new Error("unknown API key");
const row = await enqueueJob({ queue: "collage", type: "smoke", ownerId: owner.id, input: {} });
const deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  const j = await jobsRepo.get(row.id);
  if (j?.status === "succeeded") { console.log("job succeeded:", j.result); process.exit(0); }
  if (j?.status === "failed") { console.error("job failed:", j.errorMessage); process.exit(1); }
  await new Promise((r) => setTimeout(r, 250));
}
console.error("timed out waiting for the worker");
process.exit(1);
```
Add `"smoke": "tsx --env-file=.env scripts/smoke.ts"` to `package.json`.
- [ ] **Step 4: Full verification (all must pass before claiming done)**
```powershell
docker compose up -d
npm run db:migrate
npm run create-key -- smoke          # note the printed key as $KEY
npm run worker                        # separate terminal (async); expect "worker started"
npm run dev                           # separate terminal; expect Ready on http://localhost:3000
curl http://localhost:3000/api/health                                  # 200 {"status":"ok",...}
curl -X POST http://localhost:3000/api/uploads/presign -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"filename":"a.png","contentType":"image/png","sizeBytes":4}'
curl http://localhost:3000/api/jobs/00000000-0000-0000-0000-000000000000 -H "Authorization: Bearer $KEY"   # 404 envelope
curl http://localhost:3000/api/jobs/x                                  # 401 envelope (no key)
npm run smoke -- $KEY                                                  # "job succeeded"
```
Then upload through the presigned URL with curl `-T`/`--data-binary` and confirm it succeeds against MinIO (checks CORS/signing end-to-end). Finally:
```powershell
npm run typecheck; npm run lint; npm run format:check; npm run test; npm run build
```
All pass. Run `npx prettier --write .` first if `format:check` fails, then re-run. Stop the dev server and worker processes by PID when finished.
- [ ] **Step 5: Commit** — `feat: add landing page, API docs and smoke test`.

---

## Self-Review

**Spec coverage:** scaffold/tooling → T1; contracts + validator + tests → T2; config/AppError/pino redaction → T3; HMAC, API-key hashing, SSRF → T4; Drizzle tables (`api_keys`, `assets`, `jobs`, `webhook_deliveries`), repos, state machine → T5; BullMQ queues + job persistence, S3 presign, webhook delivery with retries and stored attempts → T6; `withApi` (auth inside route level, Zod, envelope) + the three routes → T7; ffmpeg/ffprobe helpers → T8; worker bootstrap + placeholder processors → T9; `docs/api.md`, `.env.example` (T1), landing page, smoke → T10. Out-of-scope items (planners, rate limiting, session auth) are excluded.

**Known deviations to confirm during execution:** (1) `server-only` is imported only in `src/server/http/withApi.ts` because worker-reachable modules cannot import it under plain Node; the Global Constraints line about this is intentionally explicit, tighten it if you prefer a different rule. (2) `logger.ts` reads `LOG_LEVEL` directly as a documented exception to "only `config.ts` reads `process.env`" so errors in config parsing can still be logged. (3) Zod and Next.js major versions may differ from the typings sketched here (Zod 4 vs 3 issue shapes, route `params` typing); Tasks 2 and 7 call out the adjustments and `npm run typecheck`/`npm run build` are the gates.

**Type consistency:** `JobStatus`, `JobData`, `JobRow`, `TransitionPatch`, `JobStore`, `RunJobDeps`, `WebhookDeps`, `Principal`, `ApiResult`, `QueueName` are defined once and used with identical names in later tasks.
