import crypto from 'node:crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../../db/schema.js';
import type { BlobStorage } from '../../blobstorage/index.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { createManifestBlobStoragePath } from './utils.js';

export const MAX_MANIFEST_OPERATIONS = 3000;

export interface PQLManifest {
  version: 1;
  revision: string;
  generatedAt: string;
  operations: Record<string, string>; // sha256 hash -> operation body
}

export async function generateAndUploadManifest(params: {
  db: PostgresJsDatabase<typeof schema>;
  federatedGraphId: string;
  organizationId: string;
  blobStorage: BlobStorage;
  logger: FastifyBaseLogger;
}): Promise<{ revision: string; operationCount: number }> {
  const { db, federatedGraphId, organizationId, blobStorage, logger } = params;

  const operationsRepo = new OperationsRepository(db, federatedGraphId);
  const allOperations = await operationsRepo.getAllPersistedOperationsForGraph();

  if (allOperations.length === 0) {
    logger.warn({ federatedGraphId }, 'No persisted operations with content found for manifest generation');
  }

  const truncated = allOperations.length > MAX_MANIFEST_OPERATIONS;
  const includedOperations = truncated ? allOperations.slice(0, MAX_MANIFEST_OPERATIONS) : allOperations;

  if (truncated) {
    logger.warn(
      { federatedGraphId, organizationId, total: allOperations.length, included: MAX_MANIFEST_OPERATIONS },
      `Manifest truncated: found ${allOperations.length} operations, including only the first ${MAX_MANIFEST_OPERATIONS}`,
    );
  }

  const operations: Record<string, string> = {};
  for (const op of includedOperations) {
    operations[op.hash] = op.operationContent;
  }

  // Compute revision as SHA256 of the deterministic JSON serialization (sorted keys)
  const sortedKeys = Object.keys(operations).sort();
  const sortedOperations: Record<string, string> = {};
  for (const key of sortedKeys) {
    sortedOperations[key] = operations[key];
  }
  const serialized = JSON.stringify(sortedOperations);
  const revision = crypto.createHash('sha256').update(serialized).digest('hex');

  const manifest: PQLManifest = {
    version: 1,
    revision,
    generatedAt: new Date().toISOString(),
    operations: sortedOperations,
  };

  const path = createManifestBlobStoragePath({ organizationId, fedGraphId: federatedGraphId });

  await blobStorage.putObject({
    key: path,
    body: Buffer.from(JSON.stringify(manifest), 'utf8'),
    contentType: 'application/json; charset=utf-8',
    metadata: { version: revision },
  });

  logger.debug({ revision, operationCount: allOperations.length, path }, 'PQL manifest generated and uploaded');

  return { revision, operationCount: allOperations.length };
}
