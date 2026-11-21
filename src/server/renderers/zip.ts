import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

/**
 * Writes `files` into one ZIP under their base names. Images are already compressed, so entries
 * are stored (level 0); slides are bounded by the carousel limits, so reading them whole is safe.
 */
export async function writeZip(files: readonly string[], outPath: string): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[path.basename(file)] = new Uint8Array(await readFile(file));
  await writeFile(outPath, zipSync(entries, { level: 0 }));
}
