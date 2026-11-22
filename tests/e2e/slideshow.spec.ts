import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const PUT_URL = "http://minio.test/put";

async function makePng(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "#2d9" } })
    .png()
    .toBuffer();
}

async function mockUploads(page: Page): Promise<void> {
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
}

test("shows mixed-media slideshow controls", async ({ page }) => {
  const png = await makePng();
  await mockUploads(page);

  await page.goto("/collages");
  const useOwnKey = page.getByRole("button", { name: "Use a different key" });
  if (await useOwnKey.isVisible()) await useOwnKey.click();
  await page.getByLabel("API key").fill("ak_test");
  await page.getByLabel("Images").setInputFiles({
    name: "img-0.png",
    mimeType: "image/png",
    buffer: png,
  });

  await page.getByRole("button", { name: "Slideshow" }).click();

  await expect(page.getByLabel("Canvas")).toBeVisible();
  await expect(page.getByLabel("Transition")).toBeVisible();
});
