import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getConfig } from "@/server/config";
import { AppError } from "@/server/http/errors";
import { getS3 } from "./s3";

function tooLarge(maxBytes: number): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", 413, "Object exceeds the maximum allowed size", {
    maxBytes,
  });
}

export async function headObject(
  key: string,
): Promise<{ contentType?: string; sizeBytes?: number }> {
  const res = await getS3().send(
    new HeadObjectCommand({ Bucket: getConfig().s3.bucket, Key: key }),
  );
  return { contentType: res.ContentType, sizeBytes: res.ContentLength };
}

function byteLimiter(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) cb(tooLarge(maxBytes));
      else cb(null, chunk);
    },
  });
}

/** Checks HEAD first, then enforces the cap on the stream itself since HEAD can be stale. */
export async function downloadObjectToFile(
  key: string,
  path: string,
  maxBytes: number,
): Promise<void> {
  const { sizeBytes } = await headObject(key);
  if (sizeBytes !== undefined && sizeBytes > maxBytes) throw tooLarge(maxBytes);

  const res = await getS3().send(new GetObjectCommand({ Bucket: getConfig().s3.bucket, Key: key }));
  if (!(res.Body instanceof Readable)) {
    throw new AppError("DEPENDENCY_UNAVAILABLE", 502, "Object body is unavailable");
  }
  try {
    await pipeline(res.Body, byteLimiter(maxBytes), createWriteStream(path));
  } catch (err) {
    await rm(path, { force: true });
    throw err;
  }
}

export async function uploadFile(key: string, path: string, contentType: string): Promise<number> {
  const { size } = await stat(path);
  // ContentLength is required because a file stream has no inferable length for PutObject.
  await getS3().send(
    new PutObjectCommand({
      Bucket: getConfig().s3.bucket,
      Key: key,
      Body: createReadStream(path),
      ContentType: contentType,
      ContentLength: size,
    }),
  );
  return size;
}
