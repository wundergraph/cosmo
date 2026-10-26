import pLimit from 'p-limit';
import type { FastifyBaseLogger } from 'fastify';
import type { PersistedOperationDTO } from '../../../types/index.js';
import type { BlobStorage } from '../../blobstorage/index.js';

export async function prepareOperationBlobRestore(
  storage: BlobStorage,
  operations: Pick<PersistedOperationDTO, 'filePath' | 'contents'>[],
  logger: FastifyBaseLogger,
): Promise<() => Promise<void>> {
  const limit = pLimit(25);
  const backups = await Promise.all(
    operations.map((operation) =>
      limit(async () => ({
        key: operation.filePath,
        // Older registrations may not have their operation body in the database.
        body: operation.contents
          ? Buffer.from(JSON.stringify({ version: 1, body: operation.contents }), 'utf8')
          : Buffer.from(
              await new Response(
                (await storage.getObject({ key: operation.filePath, abortSignal: AbortSignal.timeout(30_000) })).stream,
              ).arrayBuffer(),
            ),
      })),
    ),
  );

  return async () => {
    // Recovery is best-effort, but every write must settle before releasing the graph lock.
    const results = await Promise.allSettled(
      backups.map((backup) =>
        limit(() => storage.putObject({ ...backup, contentType: 'application/json; charset=utf-8' })),
      ),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason, key: backups[index].key }, 'Failed to restore persisted operation blob');
      }
    }
  };
}
