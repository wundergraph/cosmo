import { OverrideChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { AuthContext, FederatedGraphDTO, PlainMessage } from '../../../types/index.js';

/**
 * Overrides are stored per namespace, so a check approver may only override the changes that the given check
 * reports for the given operation.
 */
export async function canOverrideOperationChanges({
  subgraphRepo,
  schemaCheckRepo,
  authContext,
  graph,
  checkId,
  operationHash,
  changes,
}: {
  subgraphRepo: SubgraphRepository;
  schemaCheckRepo: SchemaCheckRepository;
  authContext: AuthContext;
  graph: FederatedGraphDTO;
  checkId?: string;
  operationHash: string;
  changes: PlainMessage<OverrideChange>[];
}) {
  if (authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
    return true;
  }

  if (!checkId) {
    return false;
  }

  const check = await subgraphRepo.checkById({
    id: checkId,
    federatedGraphTargetId: graph.targetId,
    federatedGraphId: graph.id,
  });
  if (!check || !check.affectedGraphs.some((ag) => ag.id === graph.id)) {
    return false;
  }

  const checkedSubgraphs = await schemaCheckRepo.getCheckedSubgraphTargets({ checkId: check.id });
  if (!authContext.rbac.canApproveCheck(graph, checkedSubgraphs)) {
    return false;
  }

  const checkChanges = await schemaCheckRepo.getBreakingChangesOfOperation({
    checkId,
    federatedGraphId: graph.id,
    operationHash,
  });

  return changes.every((change) =>
    checkChanges.some(({ changeType, path }) => changeType === change.changeType && path === change.path),
  );
}
