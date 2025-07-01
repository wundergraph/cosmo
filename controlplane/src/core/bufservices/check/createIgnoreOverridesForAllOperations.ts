import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateIgnoreOverridesForAllOperationsRequest,
  CreateIgnoreOverridesForAllOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError, PublicError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { SchemaCheckRepository } from '../../repositories/SchemaCheckRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createIgnoreOverridesForAllOperations(
  opts: RouterOptions,
  req: CreateIgnoreOverridesForAllOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateIgnoreOverridesForAllOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateIgnoreOverridesForAllOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const schemaCheckRepo = new SchemaCheckRepository(opts.db);
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

    return await opts.db.transaction(async (tx) => {
      const auditLogRepo = new AuditLogRepository(tx);
      const operationsRepo = new OperationsRepository(tx, graph.id);
      const affectedOperations = await schemaCheckRepo.getAffectedOperationsByCheckId({
        checkId: req.checkId,
        search: req.search,
      });

      for (const affectedOperation of affectedOperations) {
        const affectedChanges = await operationsRepo.createIgnoreAllOverride({
          namespaceId: graph.namespaceId,
          operationHash: affectedOperation.hash,
          operationName: affectedOperation.name,
          actorId: authContext.userId,
        });

        if (affectedChanges.length === 0) {
          throw new PublicError(
            EnumStatusCode.ERR,
            `Could not create ignore override for operation with hash ${affectedOperation.hash}`,
          );
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'operation_ignore_override.created',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'operation_ignore_all_override',
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
