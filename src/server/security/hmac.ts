import { createHmac, timingSafeEqual } from "node:crypto";

/** Signs `${timestampSec}.${body}` so a captured signature cannot be replayed with a new timestamp. */
export function signPayload(args: { secret: string; body: string; timestamp: number }): string {
  const mac = createHmac("sha256", args.secret)
    .update(`${args.timestamp}.${args.body}`)
    .digest("hex");
  return `sha256=${mac}`;
}

export function verifySignature(args: {
  secret: string;
  body: string;
  signature: string;
  timestamp: number;
  toleranceSec: number;
  nowSec?: number;
}): boolean {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - args.timestamp) > args.toleranceSec) return false;
  const expected = Buffer.from(signPayload(args));
  const actual = Buffer.from(args.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
