import { getConfig } from "@/server/config";
import { apiKeysRepo } from "@/server/db/repositories/apiKeys";
import { AppError } from "@/server/http/errors";
import { hashApiKey, parseBearer } from "./auth";

export interface Principal {
  id: string;
  name: string;
}

/**
 * The configured studio key, only for same-origin browser requests. Browsers set
 * Sec-Fetch-Site, so this blocks cross-site (CSRF) use; scripts can forge it, so the studio
 * key must only be configured on trusted deployments.
 */
function studioKeyFor(req: Request): string | null {
  const key = getConfig().studioApiKey;
  if (!key) return null;
  return req.headers.get("sec-fetch-site") === "same-origin" ? key : null;
}

export async function authenticateApiKey(req: Request): Promise<Principal> {
  const header = req.headers.get("authorization");
  const key = header === null ? studioKeyFor(req) : parseBearer(header);
  if (!key) throw new AppError("UNAUTHORIZED", 401, "Missing API key");
  const row = await apiKeysRepo.findActiveByHash(hashApiKey(key, getConfig().apiKeyPepper));
  if (!row) throw new AppError("UNAUTHORIZED", 401, "Invalid API key");
  return row;
}
