import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../client";
import { apiKeys } from "../schema";

export const apiKeysRepo = {
  async findActiveByHash(hash: string): Promise<{ id: string; name: string } | undefined> {
    const [row] = await getDb()
      .select({ id: apiKeys.id, name: apiKeys.name })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row;
  },
  async create(args: { name: string; keyHash: string }): Promise<{ id: string }> {
    const [row] = await getDb().insert(apiKeys).values(args).returning({ id: apiKeys.id });
    return row;
  },
};
