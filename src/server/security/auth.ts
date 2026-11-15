import { createHmac, randomBytes } from "node:crypto";

export function generateApiKey(): string {
  return `ak_${randomBytes(32).toString("base64url")}`;
}

/** Keys are high-entropy, so a peppered HMAC (no slow KDF) is sufficient and keeps auth fast. */
export function hashApiKey(key: string, pepper: string): string {
  return createHmac("sha256", pepper).update(key).digest("hex");
}

export function parseBearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
