import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RemoveOperationOverridesRequest,
  RemoveOperationOverridesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function removeOperationOverrides(
  opts: RouterOptions,
  req: RemoveOperationOverridesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RemoveOperationOverridesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RemoveOperationOverridesResponse>>(ctx, logger, async () => {
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
          details: 'Requested graph does not exist.',
        },
      };
    }

    if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
      throw new UnauthorizedError();
    }

    const operationsRepo = new OperationsRepository(opts.db, graph.id);

    await operationsRepo.removeOperationOverrides({
      operationHash: req.operationHash,
      namespaceId: graph.namespaceId,
      changes: req.changes,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'operation_change_override.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      auditableType: 'operation_change_override',
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
