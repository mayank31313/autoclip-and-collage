import { getConfig } from "../src/server/config";
import { getDb } from "../src/server/db/client";
import { apiKeysRepo } from "../src/server/db/repositories/apiKeys";
import { jobsRepo } from "../src/server/db/repositories/jobs";
import { enqueueJob, getProducerRedis, getQueue } from "../src/server/queue/queues";
import { hashApiKey } from "../src/server/security/auth";

async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) throw new Error("usage: npm run smoke -- <api key>");

  let queueUsed = false;
  try {
    const owner = await apiKeysRepo.findActiveByHash(hashApiKey(key, getConfig().apiKeyPepper));
    if (!owner) throw new Error("unknown API key");
    queueUsed = true;
    const row = await enqueueJob({ queue: "collage", type: "smoke", ownerId: owner.id, input: {} });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const job = await jobsRepo.get(row.id);
      if (job?.status === "succeeded") {
        console.log("job succeeded:", job.result);
        return;
      }
      if (job?.status === "failed") throw new Error(`job failed: ${job.errorMessage}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("timed out waiting for the worker");
  } finally {
    try {
      if (queueUsed) await getQueue("collage").close();
    } finally {
      try {
        if (queueUsed) await getProducerRedis().quit();
      } finally {
        await getDb().$client.end();
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "smoke test failed");
  process.exitCode = 1;
});
