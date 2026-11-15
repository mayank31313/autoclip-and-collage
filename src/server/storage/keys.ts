const MAX_NAME_LEN = 120;

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return cleaned.slice(-MAX_NAME_LEN) || "file";
}

export function buildUploadKey(args: {
  ownerId: string;
  uploadId: string;
  filename: string;
}): string {
  return `uploads/${args.ownerId}/${args.uploadId}/${sanitizeFilename(args.filename)}`;
}
