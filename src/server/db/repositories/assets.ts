import { and, eq } from "drizzle-orm";
import { AppError } from "@/server/http/errors";
import { getDb } from "../client";
import { assets } from "../schema";

export type AssetRow = typeof assets.$inferSelect;

export interface RegisterAssetArgs {
  ownerId: string;
  key: string;
  kind: "image" | "output";
  contentType: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export const assetsRepo = {
  /**
   * Idempotent per (key, owner). The unique key is global, so a duplicate that resolves to no
   * owned row means another owner holds it; a differing owned row is a conflicting re-register.
   */
  async register(args: RegisterAssetArgs): Promise<AssetRow> {
    const [inserted] = await getDb()
      .insert(assets)
      .values({
        ownerId: args.ownerId,
        key: args.key,
        kind: args.kind,
        contentType: args.contentType,
        sizeBytes: args.sizeBytes,
        metadata: args.metadata,
      })
      .onConflictDoNothing({ target: assets.key })
      .returning();
    if (inserted) return inserted;

    const existing = await assetsRepo.getByKeyForOwner(args.key, args.ownerId);
    if (
      !existing ||
      existing.kind !== args.kind ||
      existing.contentType !== args.contentType ||
      existing.sizeBytes !== args.sizeBytes
    ) {
      throw new AppError("CONFLICT", 409, "Asset key is already registered");
    }
    return existing;
  },
  async getForOwner(id: string, ownerId: string): Promise<AssetRow | undefined> {
    const [row] = await getDb()
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.ownerId, ownerId)))
      .limit(1);
    return row;
  },
  async getByKeyForOwner(key: string, ownerId: string): Promise<AssetRow | undefined> {
    const [row] = await getDb()
      .select()
      .from(assets)
      .where(and(eq(assets.key, key), eq(assets.ownerId, ownerId)))
      .limit(1);
    return row;
  },
};
