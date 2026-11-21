import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/collages`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The page only parses config; every external service is mocked at the browser boundary.
    env: {
      DATABASE_URL: "postgres://e2e:e2e@localhost:5432/e2e",
      REDIS_URL: "redis://localhost:6379",
      S3_ENDPOINT: "http://minio.test",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "e2e",
      S3_SECRET_KEY: "e2e",
      S3_BUCKET: "e2e",
      API_KEY_PEPPER: "e2e-pepper-0123456789",
      WEBHOOK_SIGNING_SECRET: "e2e-webhook-secret-0123456789",
    },
  },
});
