import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ToggleChangeOverridesForAllOperationsRequest,
  ToggleChangeOverridesForAllOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError, PublicError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function toggleChangeOverridesForAllOperations(
  opts: RouterOptions,
  req: ToggleChangeOverridesForAllOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ToggleChangeOverridesForAllOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ToggleChangeOverridesForAllOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
      };
    }

    if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
      throw new UnauthorizedError();
    }

    return opts.db.transaction(async (tx) => {
      const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const schemaCheckRepo = new SchemaCheckRepository(tx);
      const auditLogRepo = new AuditLogRepository(tx);
      const operationsRepo = new OperationsRepository(tx, graph.id);

      const affectedOperations = await schemaCheckRepo.getAffectedOperationsByCheckId({
        checkId: req.checkId,
        search: req.search,
      });
      const checkDetails = await subgraphRepo.checkDetails(req.checkId, graph.targetId);

      if (!checkDetails) {
        throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Could not find details of requested check`);
      }

      for (const affectedOperation of affectedOperations) {
        const impactingChanges = checkDetails.changes.filter(({ id }) =>
          affectedOperation.schemaChangeIds.includes(id),
        );

        const affectedRows = [];
        if (req.isSafe) {
          const res = await operationsRepo.createOperationOverrides({
            namespaceId: graph.namespaceId,
            operationHash: affectedOperation.hash,
            operationName: affectedOperation.name,
            changes: impactingChanges,
            actorId: authContext.userId,
          });
          affectedRows.push(...res);
        } else {
          const res = await operationsRepo.removeOperationOverrides({
            operationHash: affectedOperation.hash,
            namespaceId: graph.namespaceId,
            changes: impactingChanges,
          });
          affectedRows.push(...res);
        }

        if (affectedRows.length === 0) {
          throw new PublicError(
            EnumStatusCode.ERR,
            `Could not toggle change overrides for operation with hash ${affectedOperation.hash}`,
          );
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: req.isSafe ? 'operation_change_override.created' : 'operation_change_override.deleted',
          action: req.isSafe ? 'created' : 'deleted',
          actorId: authContext.userId,
          auditableType: 'operation_change_override',
          auditableDisplayName: affectedOperation.hash,
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
