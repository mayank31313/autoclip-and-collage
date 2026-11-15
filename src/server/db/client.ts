import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "@/server/config";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazy so importing this module never opens a connection (keeps tests and builds side-effect free). */
export function getDb() {
  db ??= drizzle(postgres(getConfig().databaseUrl, { max: 10 }), { schema });
  return db;
}
