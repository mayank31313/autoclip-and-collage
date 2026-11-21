import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const RESULT_URL = "https://minio.test/result.png";
const PUT_URL = "http://minio.test/put";
const OBJECT_KEY = "uploads/owner/u1/a.png";

const OUTPUT = {
  width: 1080,
  height: 1080,
  format: "png",
  downloadUrl: RESULT_URL,
  expiresInSec: 900,
};

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#d22" } })
    .png()
    .toBuffer();
}

/** Mocks the result image and the object store (including the CORS preflight for the PUT). */
async function mockStorage(page: Page, png: Buffer): Promise<void> {
  await page.route(RESULT_URL, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  await page.route(PUT_URL, (route) =>
    route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    }),
  );
}

async function fillForm(page: Page, png: Buffer): Promise<void> {
  await page.goto("/collages");
  await page.getByLabel("API key").fill("ak_test");
  await page
    .getByLabel("Images")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await expect(page.getByLabel("Justified rows")).toBeChecked();
}

test("uploads, creates, and downloads a collage", async ({ page }) => {
  const png = await makePng();
  await mockStorage(page, png);
  await page.route("**/api/uploads/presign", (route) =>
    route.fulfill({ json: { url: PUT_URL, key: OBJECT_KEY, expiresInSec: 900 } }),
  );
  await page.route("**/api/collages", (route) =>
    route.fulfill({ status: 202, json: { jobId: "j1" } }),
  );
  let polls = 0;
  await page.route("**/api/jobs/j1", (route) => {
    polls += 1;
    return route.fulfill({
      json: {
        id: "j1",
        type: "collage.build",
        status: polls === 1 ? "running" : "succeeded",
        progress: polls === 1 ? 50 : 100,
        result: polls === 1 ? null : { output: OUTPUT },
        error: null,
      },
    });
  });

  await fillForm(page, png);
  await page.getByRole("button", { name: "Create collage" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download collage" })).toHaveAttribute(
    "href",
    RESULT_URL,
  );
});

test("retries a failed job without uploading again", async ({ page }) => {
  const png = await makePng();
  await mockStorage(page, png);
  let presignCalls = 0;
  let createCalls = 0;
  await page.route("**/api/uploads/presign", (route) => {
    presignCalls += 1;
    return route.fulfill({ json: { url: PUT_URL, key: OBJECT_KEY, expiresInSec: 900 } });
  });
  await page.route("**/api/collages", (route) => {
    createCalls += 1;
    return route.fulfill({ status: 202, json: { jobId: `j${createCalls}` } });
  });
  await page.route("**/api/jobs/j*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const failed = id === "j1";
    return route.fulfill({
      json: {
        id,
        type: "collage.build",
        status: failed ? "failed" : "succeeded",
        progress: 100,
        result: failed ? null : { output: OUTPUT },
        error: failed ? { code: "JOB_FAILED", message: "Image processing failed" } : null,
      },
    });
  });

  await fillForm(page, png);
  await page.getByRole("button", { name: "Create collage" }).click();
  // Next.js renders its own empty role="alert" route announcer, so match on text.
  await expect(
    page.getByRole("alert").filter({ hasText: "Image processing failed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry collage" }).click();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();
  expect(createCalls).toBe(2);
  expect(presignCalls).toBe(1);
});

test("locks inputs while an upload is in progress", async ({ page }) => {
  const png = await makePng();
  await page.route(RESULT_URL, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  let releasePut: () => void = () => undefined;
  const putGate = new Promise<void>((resolve) => {
    releasePut = resolve;
  });
  await page.route(PUT_URL, async (route) => {
    const preflight = route.request().method() === "OPTIONS";
    if (!preflight) await putGate;
    await route.fulfill({
      status: preflight ? 204 : 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  });
  await page.route("**/api/uploads/presign", (route) =>
    route.fulfill({ json: { url: PUT_URL, key: OBJECT_KEY, expiresInSec: 900 } }),
  );
  await page.route("**/api/collages", (route) =>
    route.fulfill({ status: 202, json: { jobId: "j1" } }),
  );
  await page.route("**/api/jobs/j1", (route) =>
    route.fulfill({
      json: {
        id: "j1",
        type: "collage.build",
        status: "succeeded",
        progress: 100,
        result: { output: OUTPUT },
        error: null,
      },
    }),
  );

  await fillForm(page, png);
  await page.getByRole("button", { name: "Create collage" }).click();
  await expect(page.getByLabel("API key")).toBeDisabled();
  await expect(page.getByLabel("Images", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Justified rows")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create collage" })).toBeDisabled();

  releasePut();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();
  await expect(page.getByLabel("API key")).toBeEnabled();
  await expect(page.getByLabel("Images", { exact: true })).toBeEnabled();
});

test("keeps the API key out of storage and URLs", async ({ page }) => {
  const png = await makePng();
  await mockStorage(page, png);
  const auth: (string | undefined)[] = [];
  await page.route("**/api/uploads/presign", (route) => {
    auth.push(route.request().headers()["authorization"]);
    return route.fulfill({ json: { url: PUT_URL, key: OBJECT_KEY, expiresInSec: 900 } });
  });
  await page.route("**/api/collages", (route) =>
    route.fulfill({ status: 202, json: { jobId: "j1" } }),
  );
  await page.route("**/api/jobs/j1", (route) =>
    route.fulfill({
      json: {
        id: "j1",
        type: "collage.build",
        status: "succeeded",
        progress: 100,
        result: { output: OUTPUT },
        error: null,
      },
    }),
  );

  await fillForm(page, png);
  await page.getByRole("button", { name: "Create collage" }).click();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();

  expect(auth).toEqual(["Bearer ak_test"]);
  expect(page.url()).not.toContain("ak_test");
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]),
  );
  expect(stored).not.toContain("ak_test");
});
