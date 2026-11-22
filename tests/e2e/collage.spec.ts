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

async function attach(page: Page, png: Buffer, count: number): Promise<void> {
  const files = Array.from({ length: count }, (_, i) => ({
    name: `img-${i}.png`,
    mimeType: "image/png",
    buffer: png,
  }));
  await page.getByLabel("Images").setInputFiles(files);
}

async function fillForm(page: Page, png: Buffer, count = 1): Promise<void> {
  await page.goto("/collages");
  // A dev server with STUDIO_API_KEY pre-fills the key; these tests use their own key.
  const useOwnKey = page.getByRole("button", { name: "Use a different key" });
  if (await useOwnKey.isVisible()) await useOwnKey.click();
  await page.getByLabel("API key").fill("ak_test");
  await attach(page, png, count);
  await expect(page.getByLabel("Justified rows")).toBeChecked();
}

/** Mocks every API call for a successful run and returns the captured create-collage bodies. */
async function mockSuccessfulRun(page: Page, png: Buffer): Promise<unknown[]> {
  await mockStorage(page, png);
  const bodies: unknown[] = [];
  let uploads = 0;
  await page.route("**/api/uploads/presign", (route) => {
    uploads += 1;
    return route.fulfill({
      json: { url: PUT_URL, key: `uploads/owner/u${uploads}/a.png`, expiresInSec: 900 },
    });
  });
  await page.route("**/api/collages", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { jobId: "j1" } });
  });
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
  return bodies;
}

test("guides visitors from the studio home into the collage workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Make something worth sharing." })).toBeVisible();
  await expect
    .poll(() => page.locator("body").evaluate((body) => getComputedStyle(body).fontFamily))
    .toContain("Geist");
  await page.getByRole("link", { name: "Create a collage", exact: true }).click();
  await expect(page).toHaveURL(/\/collages$/);
  await expect(page.getByRole("heading", { name: "Create a collage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your images" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose your layout" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set your output" })).toBeVisible();
});

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

test("creates a collage from a ready-made template", async ({ page }) => {
  const png = await makePng();
  const bodies = await mockSuccessfulRun(page, png);

  await fillForm(page, png, 4);
  await page.getByRole("radio", { name: /^Template/ }).check();
  await expect(page.getByRole("radio", { name: /3×3 grid/ })).toBeDisabled();
  await expect(page.getByRole("img", { name: "2×2 grid layout preview" })).toBeVisible();
  await page.getByRole("radio", { name: /2×2 grid/ }).check();
  await page.getByRole("button", { name: "Create collage" }).click();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ style: "template", template: "grid-2x2" });
});

test("builds a custom layout with the grid builder and JSON editor", async ({ page }) => {
  const png = await makePng();
  const bodies = await mockSuccessfulRun(page, png);

  await fillForm(page, png, 3);
  await page.getByRole("radio", { name: /^Create your own/ }).check();
  await expect(page.getByText("Needs 4 images")).toBeVisible();
  await page.getByLabel("Columns", { exact: true }).fill("3");
  await page.getByLabel("Rows", { exact: true }).fill("1");
  await expect(page.getByText("Needs 3 images")).toBeVisible();

  await page.getByText("Advanced: edit JSON").click();
  const json = page.getByLabel("Custom template JSON");
  await json.fill("{ not json");
  await expect(page.getByText("Invalid layout")).toBeVisible();
  await page.getByRole("button", { name: "Reset from grid" }).click();
  await expect(page.getByText("Needs 3 images")).toBeVisible();

  await page.getByRole("button", { name: "Create collage" }).click();
  await expect(page.getByRole("img", { name: "Generated collage" })).toBeVisible();
  expect(bodies).toHaveLength(1);
  const body = bodies[0] as {
    style: string;
    template?: string;
    customTemplate: { cells: unknown[] };
  };
  expect(body.style).toBe("template");
  expect(body.template).toBeUndefined();
  expect(body.customTemplate.cells).toHaveLength(3);
});
