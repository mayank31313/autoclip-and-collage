import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const PUT_URL = "http://minio.test/put";
const ZIP_URL = "https://minio.test/polaroid.zip";
const slideUrl = (n: number) => `https://minio.test/slide-0${n}.png`;

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#d22" } })
    .png()
    .toBuffer();
}

/** Mocks storage, presign, create and job polling; returns the captured create-collage bodies. */
async function mockRun(page: Page, png: Buffer): Promise<unknown[]> {
  for (const n of [1, 2]) {
    await page.route(slideUrl(n), (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: png }),
    );
  }
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
  let uploads = 0;
  await page.route("**/api/uploads/presign", (route) => {
    uploads += 1;
    return route.fulfill({
      json: { url: PUT_URL, key: `uploads/owner/u${uploads}/a.png`, expiresInSec: 900 },
    });
  });
  const bodies: unknown[] = [];
  await page.route("**/api/collages", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { jobId: "j1" } });
  });
  await page.route("**/api/jobs/j1", (route) =>
    route.fulfill({
      json: {
        id: "j1",
        type: "collage.polaroid",
        status: "succeeded",
        progress: 100,
        result: {
          output: {
            slideCount: 2,
            slideWidth: 1080,
            slideHeight: 1080,
            slideFormat: "png",
            zipUrl: ZIP_URL,
            slides: [
              { index: 0, url: slideUrl(1) },
              { index: 1, url: slideUrl(2) },
            ],
            expiresInSec: 900,
          },
        },
        error: null,
      },
    }),
  );
  return bodies;
}

async function openPolaroidForm(page: Page, png: Buffer, count: number): Promise<void> {
  await page.goto("/collages");
  // A dev server with STUDIO_API_KEY pre-fills the key; these tests use their own key.
  const useOwnKey = page.getByRole("button", { name: "Use a different key" });
  if (await useOwnKey.isVisible()) await useOwnKey.click();
  await page.getByLabel("API key").fill("ak_test");
  await page.getByLabel("Images").setInputFiles(
    Array.from({ length: count }, (_, i) => ({
      name: `img-${i}.png`,
      mimeType: "image/png",
      buffer: png,
    })),
  );
  await page.getByLabel("Polaroid carousel").check();
}

test("creates a polaroid carousel with captions and previews its slides", async ({ page }) => {
  const png = await makePng();
  const bodies = await mockRun(page, png);
  await openPolaroidForm(page, png, 4);

  await expect(page.getByRole("heading", { name: "Shape your carousel" })).toBeVisible();
  await expect(page.getByLabel("Slides", { exact: true })).toHaveAttribute(
    "placeholder",
    "Auto (2)",
  );
  await page.getByLabel("Square 1:1").check();
  await page.getByLabel("Caption for img-0.png").fill("Summer 2025");
  await page.getByRole("button", { name: "Create collage" }).click();

  await expect(page.getByRole("img", { name: "Slide 1 of 2" })).toBeVisible();
  expect(bodies[0]).toMatchObject({
    mode: "polaroid",
    format: "png",
    polaroid: { slideAspect: "1:1", captions: ["Summer 2025", "", "", ""] },
  });
  expect(bodies[0]).not.toHaveProperty("canvas");

  await expect(page.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(page.getByRole("img", { name: "Slide 2 of 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download all slides (ZIP)" })).toHaveAttribute(
    "href",
    ZIP_URL,
  );
});

test("blocks a carousel with fewer images than slides", async ({ page }) => {
  const png = await makePng();
  const bodies = await mockRun(page, png);
  await openPolaroidForm(page, png, 3);

  await page.getByLabel("Slides", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Create collage" }).click();

  await expect(page.getByText("4 slides need at least 4 images")).toBeVisible();
  expect(bodies).toHaveLength(0);
});
