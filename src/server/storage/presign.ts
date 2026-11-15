import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "@/server/config";
import { getS3 } from "./s3";

export async function presignPut(args: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ url: string; expiresInSec: number }> {
  const { s3, presignTtlSec } = getConfig();
  const url = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: args.key,
      ContentType: args.contentType,
      ContentLength: args.sizeBytes,
    }),
    { expiresIn: presignTtlSec },
  );
  return { url, expiresInSec: presignTtlSec };
}

export async function presignGet(key: string): Promise<string> {
  const { s3, presignTtlSec } = getConfig();
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: s3.bucket, Key: key }), {
    expiresIn: presignTtlSec,
  });
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: getConfig().s3.bucket, Key: key }));
    return true;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}
