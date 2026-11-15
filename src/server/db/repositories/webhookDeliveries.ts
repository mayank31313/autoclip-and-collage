import { getDb } from "../client";
import { webhookDeliveries } from "../schema";

export const webhookDeliveriesRepo = {
  async record(args: {
    eventId: string;
    jobId: string;
    url: string;
    attempt: number;
    statusCode?: number;
    error?: string;
  }): Promise<void> {
    await getDb().insert(webhookDeliveries).values(args);
  },
};
