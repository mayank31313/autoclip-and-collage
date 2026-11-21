import { describe, expect, it } from "vitest";
import { loadConfig } from "@/server/config";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/d",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "k",
  S3_SECRET_KEY: "s",
  S3_BUCKET: "b",
  API_KEY_PEPPER: "p".repeat(16),
  WEBHOOK_SIGNING_SECRET: "w".repeat(16),
};

describe("loadConfig", () => {
  it("parses a valid env and applies defaults", () => {
    const c = loadConfig(valid);
    expect(c.ffmpegHwaccel).toBe("none");
    expect(c.workerConcurrencyRender).toBe(2);
    expect(c.maxUploadBytes).toBe(2048 * 1024 * 1024);
  });
  it("loads bounded collage defaults", () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      maxImageUploadBytes: 200 * 1024 * 1024,
      collageMaxImages: 20,
      collageMaxInputPixels: 200_000_000,
      collageMaxCanvasPixels: 40_000_000,
      collageMaxDimension: 8192,
      workerConcurrencyCollage: 1,
    });
  });
  it("loads polaroid defaults and overrides", () => {
    expect(loadConfig(valid)).toMatchObject({
      polaroidMaxSpreadPixels: 20_000_000,
      polaroidFontPath: "assets/fonts/Caveat-Regular.ttf",
    });
    expect(loadConfig({ ...valid, COLLAGE_POLAROID_MAX_SPREAD_PIXELS: "5000000" })).toMatchObject({
      polaroidMaxSpreadPixels: 5_000_000,
    });
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
