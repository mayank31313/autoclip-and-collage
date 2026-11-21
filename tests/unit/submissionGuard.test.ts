import { describe, expect, it } from "vitest";
import { createSubmissionGuard } from "@/features/collage/submissionGuard";

describe("createSubmissionGuard", () => {
  it("treats only the latest submission as current", () => {
    const guard = createSubmissionGuard();
    const first = guard.begin();
    expect(guard.isCurrent(first)).toBe(true);
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidates an in-flight submission", () => {
    const guard = createSubmissionGuard();
    const token = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });
});
