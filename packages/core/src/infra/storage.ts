// File storage adapter (spec §77). Local filesystem by default — works with no
// Internet. An S3-compatible adapter (e.g. MinIO on the edge, or cloud
// storage for off-site copies) implements the same interface.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  key: string;
  sizeBytes: number;
  sha256: string;
}

export interface FileStorage {
  put(prefix: string, data: Buffer, ext?: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export class LocalFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    // Path traversal guard: keys can never escape the storage root.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  async put(prefix: string, data: Buffer, ext = ""): Promise<StoredObject> {
    const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, "_");
    const key = `${safePrefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext.replace(/[^.a-z0-9]/gi, "")}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return { key, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async health() {
    try {
      await mkdir(this.root, { recursive: true });
      await stat(this.root);
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}
