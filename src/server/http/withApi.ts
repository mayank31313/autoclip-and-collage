import "server-only";
import { randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import { logger } from "@/server/logger";
import { authenticateApiKey, type Principal } from "@/server/security/principal";
import { AppError, errorBody } from "./errors";
import type { ApiResult } from "./responses";

export interface ApiContext {
  principal: Principal | null;
  requestId: string;
}

export interface ApiDeps {
  authenticate(req: Request): Promise<Principal>;
  logger: { info(o: object, m?: string): void; error(o: object, m?: string): void };
}

export function requirePrincipal(ctx: ApiContext): Principal {
  if (!ctx.principal) throw new AppError("UNAUTHORIZED", 401, "Authentication required");
  return ctx.principal;
}

interface RouteCtx {
  params?: Promise<Record<string, string>>;
}

function parseOrThrow<T extends ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new AppError("VALIDATION_FAILED", 400, `Invalid ${what}`, { issues });
  }
  return r.data;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", 400, "Invalid JSON body");
  }
}

export function createWithApi(deps: ApiDeps) {
  return function withApi<
    B extends ZodType = ZodType<undefined>,
    Q extends ZodType = ZodType<undefined>,
  >(
    opts: { auth: "apiKey" | "none"; body?: B; query?: Q },
    handler: (a: {
      body: z.infer<B>;
      query: z.infer<Q>;
      params: Record<string, string>;
      ctx: ApiContext;
    }) => Promise<ApiResult>,
  ) {
    return async (req: Request, route?: RouteCtx): Promise<Response> => {
      const requestId = randomUUID();
      const started = Date.now();
      let status = 500;
      try {
        const principal = opts.auth === "apiKey" ? await deps.authenticate(req) : null;
        // Absent schemas leave body/query undefined, which is exactly what the default
        // ZodType<undefined> generics promise to the handler.
        const query = (
          opts.query
            ? parseOrThrow(opts.query, Object.fromEntries(new URL(req.url).searchParams), "query")
            : undefined
        ) as z.infer<Q>;
        const body = (
          opts.body ? parseOrThrow(opts.body, await readJson(req), "body") : undefined
        ) as z.infer<B>;
        const params = (await route?.params) ?? {};
        const result = await handler({ body, query, params, ctx: { principal, requestId } });
        status = result.status ?? 200;
        return Response.json(result.json, { status, headers: { "x-request-id": requestId } });
      } catch (err) {
        const e = errorBody(err);
        status = e.status;
        if (e.status >= 500) deps.logger.error({ requestId, err }, "request failed");
        return Response.json(e.body, { status: e.status, headers: { "x-request-id": requestId } });
      } finally {
        deps.logger.info(
          {
            requestId,
            method: req.method,
            path: new URL(req.url).pathname,
            status,
            ms: Date.now() - started,
          },
          "request",
        );
      }
    };
  };
}

export const withApi = createWithApi({ authenticate: authenticateApiKey, logger });
