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
  WORKER_CONCURRENCY_COLLAGE: z.coerce.number().int().positive().default(1),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(2048),
  MAX_IMAGE_UPLOAD_MB: z.coerce.number().int().positive().default(200),
  COLLAGE_MAX_IMAGES: z.coerce.number().int().positive().default(20),
  COLLAGE_MAX_INPUT_PIXELS: z.coerce.number().int().positive().default(200_000_000),
  COLLAGE_MAX_CANVAS_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  COLLAGE_MAX_DIMENSION: z.coerce.number().int().positive().default(8192),
  COLLAGE_TEMPLATES_DIR: z.string().min(1).default("assets/collage-templates"),
  COLLAGE_POLAROID_MAX_SPREAD_PIXELS: z.coerce.number().int().positive().default(20_000_000),
  POLAROID_FONT_PATH: z.string().min(1).default("assets/fonts/Caveat-Regular.ttf"),
  SLIDESHOW_MAX_SLIDES: z.coerce.number().int().positive().default(20),
  SLIDESHOW_MAX_SLIDE_SEC: z.coerce.number().int().positive().default(30),
  SLIDESHOW_MAX_DURATION_SEC: z.coerce.number().int().positive().default(300),
  SLIDESHOW_MAX_TRANSITION_SEC: z.coerce.number().int().positive().default(2),
  STUDIO_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
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
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      bucket: e.S3_BUCKET,
    },
    apiKeyPepper: e.API_KEY_PEPPER,
    webhookSecret: e.WEBHOOK_SIGNING_SECRET,
    ollamaUrl: e.OLLAMA_URL,
    mlSidecarUrl: e.ML_SIDECAR_URL,
    ffmpegHwaccel: e.FFMPEG_HWACCEL,
    workerConcurrencyRender: e.WORKER_CONCURRENCY_RENDER,
    workerConcurrencyAnalyze: e.WORKER_CONCURRENCY_ANALYZE,
    workerConcurrencyCollage: e.WORKER_CONCURRENCY_COLLAGE,
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
    maxImageUploadBytes: e.MAX_IMAGE_UPLOAD_MB * 1024 * 1024,
    collageMaxImages: e.COLLAGE_MAX_IMAGES,
    collageMaxInputPixels: e.COLLAGE_MAX_INPUT_PIXELS,
    collageMaxCanvasPixels: e.COLLAGE_MAX_CANVAS_PIXELS,
    collageMaxDimension: e.COLLAGE_MAX_DIMENSION,
    collageTemplatesDir: e.COLLAGE_TEMPLATES_DIR,
    polaroidMaxSpreadPixels: e.COLLAGE_POLAROID_MAX_SPREAD_PIXELS,
    polaroidFontPath: e.POLAROID_FONT_PATH,
    slideshowMaxSlides: e.SLIDESHOW_MAX_SLIDES,
    slideshowMaxSlideSec: e.SLIDESHOW_MAX_SLIDE_SEC,
    slideshowMaxDurationSec: e.SLIDESHOW_MAX_DURATION_SEC,
    slideshowMaxTransitionSec: e.SLIDESHOW_MAX_TRANSITION_SEC,
    studioApiKey: e.STUDIO_API_KEY,
    presignTtlSec: e.PRESIGN_TTL_SEC,
    webhookToleranceSec: e.WEBHOOK_TOLERANCE_SEC,
    logLevel: e.LOG_LEVEL,
  };
}

export type Config = ReturnType<typeof loadConfig>;

let cached: Config | undefined;
/** The only place `process.env` is read (apart from the logger's LOG_LEVEL). */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
