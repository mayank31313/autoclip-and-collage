import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeZip } from "@/server/renderers/zip";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polaroid-zip-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeZip", () => {
  it("stores each file under its base name, in order", async () => {
    const one = path.join(dir, "slide-01.png");
    const two = path.join(dir, "slide-02.png");
    await writeFile(one, "first");
    await writeFile(two, "second");
    const out = path.join(dir, "out.zip");
    await writeZip([one, two], out);
    const entries = unzipSync(new Uint8Array(await readFile(out)));
    expect(Object.keys(entries)).toEqual(["slide-01.png", "slide-02.png"]);
    expect(Buffer.from(entries["slide-02.png"] ?? new Uint8Array()).toString()).toBe("second");
  });

  it("rejects when a file is missing", async () => {
    await expect(
      writeZip([path.join(dir, "missing.png")], path.join(dir, "never.zip")),
    ).rejects.toThrow();
  });
});
