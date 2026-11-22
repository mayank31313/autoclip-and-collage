import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCollageTemplates } from "@/server/templates/collageTemplates";

const ASSETS_DIR = path.resolve("assets/collage-templates");

function template(id: string, cellCount: number) {
  return {
    version: 1,
    id,
    name: id,
    cols: Array.from({ length: cellCount }, () => 1),
    rows: [1],
    cells: Array.from({ length: cellCount }, (_, col) => ({ col, row: 0 })),
  };
}

describe("loadCollageTemplates", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "templates-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const put = (name: string, body: unknown) =>
    writeFile(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));

  it("loads valid JSON files sorted by image count then id, ignoring other files", async () => {
    await put("b-three.json", template("b-three", 3));
    await put("a-three.json", template("a-three", 3));
    await put("two.json", template("two", 2));
    await put("README.md", "not a template");
    const loaded = await loadCollageTemplates(dir);
    expect(loaded.map((t) => t.id)).toEqual(["two", "a-three", "b-three"]);
  });

  it("names the file when JSON is malformed", async () => {
    await put("broken.json", "{ nope");
    await expect(loadCollageTemplates(dir)).rejects.toThrow(/broken\.json/);
  });

  it("names the file when the template is invalid", async () => {
    await put("bad.json", { ...template("bad", 2), cols: [] });
    await expect(loadCollageTemplates(dir)).rejects.toThrow(/bad\.json/);
  });

  it("requires the id to match the file name", async () => {
    await put("other.json", template("mismatch", 2));
    await expect(loadCollageTemplates(dir)).rejects.toThrow(/other\.json.*mismatch/);
  });

  it("loads every shipped sample template", async () => {
    const loaded = await loadCollageTemplates(ASSETS_DIR);
    expect(loaded.map((t) => [t.id, t.cells.length])).toEqual([
      ["hero-2-stacked", 3],
      ["grid-2x2", 4],
      ["strip-1-3", 4],
      ["hero-4", 5],
      ["grid-2x3", 6],
      ["magazine-hero-5", 6],
      ["grid-3x3", 9],
    ]);
  });
});
