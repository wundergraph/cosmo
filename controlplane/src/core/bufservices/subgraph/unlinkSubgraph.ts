import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { UnlinkSubgraphRequest, UnlinkSubgraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function unlinkSubgraph(
  opts: RouterOptions,
  req: UnlinkSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UnlinkSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UnlinkSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.sourceSubgraphNamespace = req.sourceSubgraphNamespace || DefaultNamespace;

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const sourceSubgraph = await subgraphRepo.byName(req.sourceSubgraphName, req.sourceSubgraphNamespace);
    if (!sourceSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.sourceSubgraphName}" was not found.`,
        },
      };
    }

    if (!authContext.rbac.hasSubGraphWriteAccess(sourceSubgraph)) {
      throw new UnauthorizedError();
    }

    const linkedSubgraph = await subgraphRepo.getLinkedSubgraph({ sourceSubgraphId: sourceSubgraph.id });
    if (!linkedSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The source subgraph "${req.sourceSubgraphName}" is not linked to any subgraph.`,
        },
      };
    }

    await subgraphRepo.unlinkSubgraph({
      sourceSubgraphId: sourceSubgraph.id,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'subgraph.unlinked',
      action: 'unlinked',
      actorId: authContext.userId,
      auditableType: 'subgraph',
      auditableDisplayName: sourceSubgraph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: sourceSubgraph.namespaceId,
      targetNamespaceDisplayName: sourceSubgraph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
