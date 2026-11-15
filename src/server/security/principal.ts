import { getConfig } from "@/server/config";
import { apiKeysRepo } from "@/server/db/repositories/apiKeys";
import { AppError } from "@/server/http/errors";
import { hashApiKey, parseBearer } from "./auth";

export interface Principal {
  id: string;
  name: string;
}

export async function authenticateApiKey(req: Request): Promise<Principal> {
  const key = parseBearer(req.headers.get("authorization"));
  if (!key) throw new AppError("UNAUTHORIZED", 401, "Missing API key");
  const row = await apiKeysRepo.findActiveByHash(hashApiKey(key, getConfig().apiKeyPepper));
  if (!row) throw new AppError("UNAUTHORIZED", 401, "Invalid API key");
  return row;
}
