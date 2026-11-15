import { getConfig } from "@/server/config";
import { apiKeysRepo } from "@/server/db/repositories/apiKeys";
import { generateApiKey, hashApiKey } from "@/server/security/auth";

// Wrapped in main() because the package is CommonJS, where tsx rejects top-level await.
async function main(): Promise<void> {
  const name = process.argv[2] ?? "default";
  const key = generateApiKey();
  const { id } = await apiKeysRepo.create({
    name,
    keyHash: hashApiKey(key, getConfig().apiKeyPepper),
  });
  console.log(
    `Created API key "${name}" (id ${id}). Store it now, it cannot be shown again:\n${key}`,
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
