import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
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
    const operationsRepo = new OperationsRepository(transactionDB, graph.id);
    if (!(await operationsRepo.lockPersistedOperations())) {
      throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Federated graph '${graph.name}' does not exist`);
    }

    // Keep the transaction and graph lock until blob changes and manifest publication finish.
    return fn(operationsRepo, transactionDB);
  });
}
