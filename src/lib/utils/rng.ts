/** 32-bit FNV-1a hash of `parts` joined by a newline; stable across runtimes. */
export function hashStrings(parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const ch of parts.join("\n")) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Seeded generator returning floats in [0, 1) (mulberry32). Same seed gives the same sequence. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
