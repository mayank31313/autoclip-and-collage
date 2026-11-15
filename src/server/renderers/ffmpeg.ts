import { spawn } from "node:child_process";

const STDERR_TAIL_CHARS = 8000;

/** Runs ffmpeg with an argument array (never a shell string). Rejects with the stderr tail on failure. */
export function runFfmpeg(
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new Error("ffmpeg aborted before start"));
      return;
    }
    const p = spawn("ffmpeg", ["-hide_banner", "-y", "-nostdin", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let reason: string | undefined;
    const kill = (why: string) => {
      reason = why;
      p.kill("SIGKILL");
    };
    p.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-STDERR_TAIL_CHARS);
    });
    const timer = setTimeout(
      () => kill(`ffmpeg timed out after ${opts.timeoutMs}ms`),
      opts.timeoutMs,
    );
    const onAbort = () => kill("ffmpeg aborted");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    p.on("error", (err) => {
      cleanup();
      reject(err);
    });
    p.on("close", (code) => {
      cleanup();
      if (code === 0) resolve();
      else reject(new Error(reason ?? `ffmpeg exited ${code}: ${stderr}`));
    });
  });
}

const FILTER_SPECIAL_CHARS = /[\\:'",;[\]=]/g;

/**
 * Level-1 escape: makes text a single option value (`key=<value>`) for a filter's own
 * option parser. This alone is NOT safe inside a `-vf`/`-filter_complex` string, because
 * FFmpeg unescapes once more at the filtergraph level before the option parser runs.
 * Use `escapeFilterGraphValue` when embedding user text in a filtergraph string.
 */
export function escapeFilterText(text: string): string {
  return text.replace(FILTER_SPECIAL_CHARS, (c) => `\\${c}`);
}

/**
 * Two-level escape (option value, then filtergraph): the form callers must use when
 * dropping user text into a `-vf`/`-filter_complex` string, so it cannot inject filters
 * or options. TODO(milestone-3): drawtext also expands `%{...}`; the caller must handle that
 * separately (e.g. `expansion=none`).
 */
export function escapeFilterGraphValue(text: string): string {
  return escapeFilterText(escapeFilterText(text));
}
