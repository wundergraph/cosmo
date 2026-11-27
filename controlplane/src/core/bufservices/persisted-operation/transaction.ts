import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { DB } from '../../../db/index.js';
import { PublicError } from '../../errors/errors.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';

export function withPersistedOperationsTransaction<T>(
  db: DB,
  graph: { id: string; name: string },
  fn: (operationsRepo: OperationsRepository, db: DB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const transactionDB = tx as DB;
    await transactionDB.execute(sql`set local lock_timeout = '30s'`);
    const operationsRepo = new OperationsRepository(transactionDB, graph.id);
    try {
      if (!(await operationsRepo.lockPersistedOperations())) {
        throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Federated graph '${graph.name}' does not exist`);
      }
    } catch (error) {
      if (error instanceof postgres.PostgresError && error.code === '55P03') {
        throw new PublicError(EnumStatusCode.ERR, 'Persisted operations are busy. Please retry.', error);
      }
      throw error;
    }

    // Keep the transaction and graph lock until blob changes and manifest publication finish.
    return fn(operationsRepo, transactionDB);
  });
}
