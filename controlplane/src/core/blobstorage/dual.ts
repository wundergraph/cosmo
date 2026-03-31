import type { BlobObject, BlobStorage } from './index.js';

/**
 * A BlobStorage implementation that writes to two underlying stores (primary + secondary).
 *
 * - Writes and deletes go to both stores concurrently; both must succeed.
 * - Reads try the primary first, falling back to the secondary on failure.
 */
export class DualBlobStorage implements BlobStorage {
  constructor(
    private primary: BlobStorage,
    private secondary: BlobStorage,
  ) {}

  async putObject<Metadata extends Record<string, string>>(data: {
    key: string;
    abortSignal?: AbortSignal;
    body: Buffer;
    contentType: string;
    metadata?: Metadata;
  }): Promise<void> {
    await Promise.all([this.primary.putObject(data), this.secondary.putObject(data)]);
  }

  async getObject(data: { key: string; abortSignal?: AbortSignal }): Promise<BlobObject> {
    try {
      return await this.primary.getObject(data);
    } catch {
      return await this.secondary.getObject(data);
    }
  }

  async removeDirectory(data: { key: string; abortSignal?: AbortSignal }): Promise<number> {
    const results = await Promise.all([this.primary.removeDirectory(data), this.secondary.removeDirectory(data)]);
    return results[0];
  }

  async deleteObject(data: { key: string; abortSignal?: AbortSignal }): Promise<void> {
    await Promise.all([this.primary.deleteObject(data), this.secondary.deleteObject(data)]);
  }
}
