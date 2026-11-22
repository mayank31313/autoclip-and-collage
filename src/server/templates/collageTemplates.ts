import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CollageTemplateDefinition } from "@/lib/schemas/collageTemplate";
import { getConfig } from "@/server/config";

const JSON_EXTENSION = ".json";

async function loadFile(dir: string, file: string): Promise<CollageTemplateDefinition> {
  const text = await readFile(path.join(dir, file), "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Collage template ${file} is not valid JSON`);
  }
  const parsed = CollageTemplateDefinition.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Collage template ${file} is invalid: ${problems.join("; ")}`);
  }
  const expectedId = path.basename(file, JSON_EXTENSION);
  if (parsed.data.id !== expectedId) {
    throw new Error(`Collage template ${file} has id ${parsed.data.id}; expected ${expectedId}`);
  }
  return parsed.data;
}

/**
 * Reads and validates every `*.json` template in `dir`, sorted by image count then id.
 * Throws on the first invalid file so a broken template never ships silently.
 */
export async function loadCollageTemplates(dir: string): Promise<CollageTemplateDefinition[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(JSON_EXTENSION)).sort();
  const templates = await Promise.all(files.map((f) => loadFile(dir, f)));
  return templates.sort((a, b) => a.cells.length - b.cells.length || a.id.localeCompare(b.id));
}

let cached: Promise<CollageTemplateDefinition[]> | undefined;

/** Templates from the configured folder, loaded once per process (retried after a failure). */
export function getCollageTemplates(): Promise<CollageTemplateDefinition[]> {
  cached ??= loadCollageTemplates(path.resolve(getConfig().collageTemplatesDir)).catch(
    (err: unknown) => {
      cached = undefined;
      throw err;
    },
  );
  return cached;
}

export async function findCollageTemplate(
  id: string,
): Promise<CollageTemplateDefinition | undefined> {
  return (await getCollageTemplates()).find((t) => t.id === id);
}
