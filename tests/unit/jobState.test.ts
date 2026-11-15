import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "@/server/jobs/state";

describe("job state machine", () => {
  it.each([
    ["queued", "running"],
    ["running", "succeeded"],
    ["running", "failed"],
    ["running", "cancelled"],
    ["queued", "cancelled"],
    ["running", "queued"],
    ["queued", "failed"],
  ] as const)("allows %s -> %s", (a, b) => expect(canTransition(a, b)).toBe(true));
  it.each([
    ["succeeded", "running"],
    ["failed", "queued"],
    ["cancelled", "running"],
    ["queued", "succeeded"],
  ] as const)("blocks %s -> %s", (a, b) => expect(canTransition(a, b)).toBe(false));
  it("assertTransition throws CONFLICT on invalid moves", () => {
    expect(() => assertTransition("succeeded", "running")).toThrowError(/succeeded/);
  });
});
