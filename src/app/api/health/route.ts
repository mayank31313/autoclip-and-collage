import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { withApi } from "@/server/http/withApi";
import { getProducerRedis } from "@/server/queue/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 2000;

async function check(name: string, fn: () => Promise<unknown>): Promise<[string, boolean]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    return [name, true];
  } catch {
    return [name, false];
  } finally {
    clearTimeout(timer);
  }
}

export const GET = withApi({ auth: "none" }, async () => {
  const checks = Object.fromEntries(
    await Promise.all([
      check("db", () => getDb().execute(sql`select 1`)),
      check("redis", () => getProducerRedis().ping()),
    ]),
  );
  if (Object.values(checks).some((ok) => !ok)) {
    throw new AppError("DEPENDENCY_UNAVAILABLE", 503, "A dependency is unavailable", { checks });
  }
  return { json: { status: "ok", checks } };
});
