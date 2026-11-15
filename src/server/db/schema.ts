import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => apiKeys.id),
  key: text("key").notNull().unique(),
  kind: text("kind", { enum: ["video", "image", "output"] }).notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => apiKeys.id),
    queue: text("queue").notNull(),
    type: text("type").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    progress: integer("progress").notNull().default(0),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    webhookUrl: text("webhook_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_owner_idx").on(t.ownerId)],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  url: text("url").notNull(),
  attempt: integer("attempt").notNull(),
  statusCode: integer("status_code"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
