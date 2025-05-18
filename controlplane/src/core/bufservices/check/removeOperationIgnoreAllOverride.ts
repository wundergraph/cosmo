import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RemoveOperationIgnoreAllOverrideRequest,
  RemoveOperationIgnoreAllOverrideResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function removeOperationIgnoreAllOverride(
  opts: RouterOptions,
  req: RemoveOperationIgnoreAllOverrideRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RemoveOperationIgnoreAllOverrideResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RemoveOperationIgnoreAllOverrideResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

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

    const operationsRepo = new OperationsRepository(opts.db, graph.id);

    const affectedChanges = await operationsRepo.removeIgnoreAllOverride({
      namespaceId: graph.namespaceId,
      operationHash: req.operationHash,
    });

    if (affectedChanges.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Could not remove ignore override for this operation',
        },
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'operation_ignore_override.deleted',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'operation_ignore_all_override',
      auditableDisplayName: req.operationHash,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: graph.namespaceId,
      targetNamespaceDisplayName: graph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
