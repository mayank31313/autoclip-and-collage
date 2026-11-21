import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Cond = { column: string; value: unknown };

const mocks = vi.hoisted(() => ({ send: vi.fn(), rows: [] as Row[] }));

vi.mock("drizzle-orm", () => ({
  eq: (column: { name: string }, value: unknown) => ({ column: column.name, value }),
  and: (...conds: Cond[]) => conds,
}));
vi.mock("@/server/db/client", () => {
  const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const matches = (row: Row, conds: Cond[]) => conds.every((c) => row[camel(c.column)] === c.value);
  return {
    getDb: () => ({
      insert: () => ({
        values: (values: Row) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              if (mocks.rows.some((r) => r.key === values.key)) return [];
              const row = { id: `asset-${mocks.rows.length + 1}`, ...values };
              mocks.rows.push(row);
              return [row];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: (cond: Cond | Cond[]) => ({
            limit: async () => mocks.rows.filter((r) => matches(r, [cond].flat())).slice(0, 1),
          }),
        }),
      }),
    }),
  };
});
vi.mock("@/server/config", () => ({
  getConfig: () => ({ s3: { bucket: "b" } }),
}));
vi.mock("@/server/storage/s3", () => ({ getS3: () => ({ send: mocks.send }) }));

import { assetsRepo } from "@/server/db/repositories/assets";
import { downloadObjectToFile, headObject, uploadFile } from "@/server/storage/objects";

const input = {
  ownerId: "owner-1",
  key: "uploads/owner-1/u1/a.png",
  kind: "image" as const,
  contentType: "image/png",
  sizeBytes: 1234,
};

describe("assetsRepo", () => {
  beforeEach(() => {
    mocks.rows.length = 0;
  });

  it("is idempotent for the same owner and isolates other owners", async () => {
    const first = await assetsRepo.register(input);
    await expect(assetsRepo.register(input)).resolves.toEqual(first);
    expect(mocks.rows).toHaveLength(1);
    await expect(assetsRepo.getByKeyForOwner(input.key, "another-owner")).resolves.toBeUndefined();
    await expect(assetsRepo.getByKeyForOwner(input.key, "owner-1")).resolves.toEqual(first);
    await expect(assetsRepo.getForOwner(first.id, "another-owner")).resolves.toBeUndefined();
    await expect(assetsRepo.getForOwner(first.id, "owner-1")).resolves.toEqual(first);
  });

  it("throws CONFLICT when the key belongs to another owner", async () => {
    await assetsRepo.register(input);
    await expect(assetsRepo.register({ ...input, ownerId: "another-owner" })).rejects.toMatchObject(
      { code: "CONFLICT", status: 409 },
    );
  });

  it.each([{ kind: "output" as const }, { contentType: "image/jpeg" }, { sizeBytes: 99 }])(
    "throws CONFLICT when a duplicate registration differs: %o",
    async (change) => {
      await assetsRepo.register(input);
      await expect(assetsRepo.register({ ...input, ...change })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    },
  );
});

describe("object helpers", () => {
  let dir: string;
  beforeEach(async () => {
    mocks.send.mockReset();
    dir = await mkdtemp(path.join(tmpdir(), "assets-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("headObject returns content type and size", async () => {
    mocks.send.mockResolvedValue({ ContentType: "image/png", ContentLength: 42 });
    await expect(headObject("k")).resolves.toEqual({ contentType: "image/png", sizeBytes: 42 });
    expect(mocks.send.mock.calls[0][0].input).toEqual({ Bucket: "b", Key: "k" });
  });

  it("rejects an oversized object from HEAD without creating the destination", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 100 });
    const dest = path.join(dir, "out.bin");
    await expect(downloadObjectToFile("k", dest, 10)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
    await expect(stat(dest)).rejects.toThrow();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("aborts a stream that exceeds maxBytes and removes the partial file", async () => {
    mocks.send
      .mockResolvedValueOnce({ ContentLength: 5 }) // HEAD understates the real size
      .mockResolvedValueOnce({ Body: Readable.from([Buffer.alloc(8), Buffer.alloc(8)]) });
    const dest = path.join(dir, "out.bin");
    await expect(downloadObjectToFile("k", dest, 10)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    await expect(stat(dest)).rejects.toThrow();
  });

  it("downloads an object within the limit", async () => {
    mocks.send
      .mockResolvedValueOnce({ ContentLength: 6 })
      .mockResolvedValueOnce({ Body: Readable.from([Buffer.from("abc"), Buffer.from("def")]) });
    const dest = path.join(dir, "out.bin");
    await downloadObjectToFile("k", dest, 10);
    expect((await readFile(dest)).toString()).toBe("abcdef");
  });

  it("uploads a file and returns the byte count", async () => {
    const src = path.join(dir, "in.png");
    await writeFile(src, "12345");
    mocks.send.mockResolvedValue({});
    await expect(uploadFile("out/k.png", src, "image/png")).resolves.toBe(5);
    const input = mocks.send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      Bucket: "b",
      Key: "out/k.png",
      ContentType: "image/png",
      ContentLength: 5,
    });
    input.Body.destroy();
  });
});
