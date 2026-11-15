import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/server/http/errors";
import { createWithApi, requirePrincipal } from "@/server/http/withApi";

const logger = { info: () => undefined, error: () => undefined };
const principal = { id: "p1", name: "test" };
const make = (authenticate = async () => principal) => createWithApi({ authenticate, logger });
const post = (body: string) =>
  new Request("http://x/api", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });

describe("withApi", () => {
  it("validates the body and returns handler json with status", async () => {
    const withApi = make();
    const h = withApi(
      { auth: "apiKey", body: z.object({ n: z.number() }) },
      async ({ body, ctx }) => ({
        status: 202,
        json: { n: body.n, owner: requirePrincipal(ctx).id },
      }),
    );
    const res = await h(post('{"n":3}'));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ n: 3, owner: "p1" });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
  it("returns VALIDATION_FAILED for bad bodies and invalid JSON", async () => {
    const h = make()({ auth: "apiKey", body: z.object({ n: z.number() }) }, async () => ({
      json: {},
    }));
    for (const raw of ['{"n":"x"}', "not json"]) {
      const res = await h(post(raw));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
  });
  it("returns UNAUTHORIZED when authentication fails and skips the handler", async () => {
    let called = false;
    const h = make(async () => {
      throw new AppError("UNAUTHORIZED", 401, "no");
    })({ auth: "apiKey" }, async () => {
      called = true;
      return { json: {} };
    });
    const res = await h(new Request("http://x/api"));
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });
  it("does not authenticate when auth is none", async () => {
    const h = make(async () => {
      throw new Error("should not run");
    })({ auth: "none" }, async () => ({ json: { ok: true } }));
    expect((await h(new Request("http://x/api"))).status).toBe(200);
  });
  it("maps unexpected errors to a generic 500", async () => {
    const h = make()({ auth: "none" }, async () => {
      throw new Error("secret detail");
    });
    const res = await h(new Request("http://x/api"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
  it("parses query strings and awaits route params", async () => {
    const h = make()(
      { auth: "none", query: z.object({ limit: z.coerce.number() }) },
      async ({ query, params }) => ({ json: { limit: query.limit, id: params.id } }),
    );
    const res = await h(new Request("http://x/api?limit=5"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(await res.json()).toEqual({ limit: 5, id: "abc" });
  });
});
