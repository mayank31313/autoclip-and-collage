import pino from "pino";

// Single allowed process.env read outside config.ts: config validation can fail
// (e.g. missing vars), and that failure must still be loggable, so the logger
// cannot depend on getConfig().
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "*.apiKey", "*.secret", "*.url", "authorization"],
});
