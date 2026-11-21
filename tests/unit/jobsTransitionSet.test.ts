import { describe, expect, it } from "vitest";
import { buildTransitionSet } from "@/server/db/repositories/jobs";

const now = new Date("2026-01-01T00:00:00Z");

describe("buildTransitionSet", () => {
  it("clears stale error and result when a job is requeued or restarted", () => {
    for (const to of ["queued", "running"] as const) {
      expect(buildTransitionSet(to, {}, now)).toMatchObject({
        errorCode: null,
        errorMessage: null,
        result: null,
        finishedAt: null,
      });
    }
  });
  it("clears stale errors but keeps the supplied result on success", () => {
    const set = buildTransitionSet("succeeded", { progress: 100, result: { a: 1 } }, now);
    expect(set).toMatchObject({
      errorCode: null,
      errorMessage: null,
      progress: 100,
      result: { a: 1 },
      finishedAt: now,
    });
  });
  it("leaves error and result untouched when failing without them", () => {
    const set = buildTransitionSet("failed", {}, now);
    expect(set).not.toHaveProperty("errorCode");
    expect(set).not.toHaveProperty("result");
  });
  it("lets the patch override the cleared columns", () => {
    const set = buildTransitionSet("queued", { errorCode: "E", errorMessage: "m" }, now);
    expect(set).toMatchObject({ errorCode: "E", errorMessage: "m" });
  });
});
