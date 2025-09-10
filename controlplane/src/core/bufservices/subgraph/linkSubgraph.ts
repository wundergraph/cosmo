import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { LinkSubgraphRequest, LinkSubgraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function linkSubgraph(
  opts: RouterOptions,
  req: LinkSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<LinkSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<LinkSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.sourceSubgraphNamespace = req.sourceSubgraphNamespace || DefaultNamespace;

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    if (
      req.sourceSubgraphNamespace === req.targetSubgraphNamespace &&
      req.sourceSubgraphName === req.targetSubgraphName
    ) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The source and target subgraphs cannot be the same subgraphs.`,
        },
      };
    }

    const sourceNamespace = await namespaceRepo.byName(req.sourceSubgraphNamespace);
    if (!sourceNamespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The source namespace "${req.sourceSubgraphNamespace}" was not found.`,
        },
      };
    }

    const targetNamespace = await namespaceRepo.byName(req.targetSubgraphNamespace);
    if (!targetNamespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The target namespace "${req.targetSubgraphNamespace}" was not found.`,
        },
      };
    }

    const sourceSubgraph = await subgraphRepo.byName(req.sourceSubgraphName, req.sourceSubgraphNamespace);
    if (!sourceSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.sourceSubgraphName}" was not found.`,
        },
      };
    }

    if (sourceSubgraph.isFeatureSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The source subgraph "${req.sourceSubgraphName}" is a feature subgraph. Feature subgraphs can not be linked.`,
        },
      };
    }

    if (!authContext.rbac.hasSubGraphWriteAccess(sourceSubgraph)) {
      throw new UnauthorizedError();
    }

    const linkedSubgraph = await subgraphRepo.getLinkedSubgraph({ sourceSubgraphId: sourceSubgraph.id });
    if (linkedSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The source subgraph "${req.sourceSubgraphName}" is already linked to the target subgraph "${linkedSubgraph.targetSubgraphName}" in the namespace "${linkedSubgraph.targetSubgraphNamespace}". Unlink the existing link first.`,
        },
      };
    }

    const targetSubgraph = await subgraphRepo.byName(req.targetSubgraphName, req.targetSubgraphNamespace);
    if (!targetSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The target subgraph "${req.targetSubgraphName}" was not found.`,
        },
      };
    }

    if (targetSubgraph.isFeatureSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The target subgraph "${req.targetSubgraphName}" is a feature subgraph. Feature subgraphs can not be linked.`,
        },
      };
    }

    if (!authContext.rbac.hasSubGraphReadAccess(targetSubgraph)) {
      throw new UnauthorizedError();
    }

    await opts.db.transaction(async (tx) => {
      const txSubgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const txAuditLogRepo = new AuditLogRepository(tx);

      await txSubgraphRepo.linkSubgraph({
        sourceSubgraphId: sourceSubgraph.id,
        targetSubgraphId: targetSubgraph.id,
        createdById: authContext.userId,
      });

      await txAuditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'subgraph.linked',
        action: 'linked',
        actorId: authContext.userId,
        auditableType: 'subgraph',
        auditableDisplayName: sourceSubgraph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: sourceSubgraph.namespaceId,
        targetNamespaceDisplayName: sourceSubgraph.namespace,
      });
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
