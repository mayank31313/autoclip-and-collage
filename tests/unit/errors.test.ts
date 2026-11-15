import { describe, expect, it } from "vitest";
import { AppError, errorBody } from "@/server/http/errors";

describe("errorBody", () => {
  it("maps AppError to its status and envelope", () => {
    const r = errorBody(new AppError("NOT_FOUND", 404, "nope", { id: 1 }));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "NOT_FOUND", message: "nope", details: { id: 1 } } });
  });
  it("hides unknown error details", () => {
    const r = errorBody(new Error("db password is hunter2"));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(r.body)).not.toContain("hunter2");
  });
});
