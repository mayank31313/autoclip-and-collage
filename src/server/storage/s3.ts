import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@/server/config";

let client: S3Client | undefined;

export function getS3(): S3Client {
  const { s3 } = getConfig();
  client ??= new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: true, // MinIO needs path-style addressing
    credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
  });
  return client;
}
