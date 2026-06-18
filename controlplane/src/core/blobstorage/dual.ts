import { traced } from '../tracing.js';
import type { BlobObject, BlobStorage } from './index.js';

/**
 * A BlobStorage implementation that writes to two underlying stores (primary + secondary).
 *
 * - Writes and deletes go to both stores concurrently; both must succeed.
 * - Reads try the primary first, falling back to the secondary on failure.
 */
@traced
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
    const results = await Promise.allSettled([this.primary.putObject(data), this.secondary.putObject(data)]);
    const [primaryResult, secondaryResult] = results;

    if (primaryResult.status === 'fulfilled' && secondaryResult.status === 'fulfilled') {
      return;
    }

    // Roll back successful writes before throwing, independent of the caller's signal
    const rollbacks: Promise<void>[] = [];
    if (primaryResult.status === 'fulfilled') {
      rollbacks.push(this.primary.deleteObject({ key: data.key }));
    }
    if (secondaryResult.status === 'fulfilled') {
      rollbacks.push(this.secondary.deleteObject({ key: data.key }));
    }
    const rollbackResults = await Promise.allSettled(rollbacks);

    const putErrors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => r.reason);
    const rollbackErrors = rollbackResults
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason);
    throw new AggregateError([...putErrors, ...rollbackErrors], 'Failed to put object into storage');
  }

  async getObject(data: { key: string; abortSignal?: AbortSignal }): Promise<BlobObject> {
    try {
      return await this.primary.getObject(data);
    } catch (primaryError) {
      try {
        return await this.secondary.getObject(data);
      } catch (secondaryError) {
        throw new AggregateError(
          [primaryError, secondaryError],
          'Both primary and secondary storage failed to get object',
        );
      }
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
