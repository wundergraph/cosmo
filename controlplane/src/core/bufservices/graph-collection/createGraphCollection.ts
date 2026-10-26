import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateGraphCollectionRequest,
  CreateGraphCollectionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { validateCollectionName } from '../../util/graph-collection/validation.js';

export function createGraphCollection(
  opts: RouterOptions,
  req: CreateGraphCollectionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateGraphCollectionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateGraphCollectionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const validated = validateCollectionName(req.name, 'Collection');
    if (!validated.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: validated.error,
        },
        id: '',
      };
    }
    const name = validated.name;

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        id: '',
      };
    }

    const allowed = req.teamScoped
      ? authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)
      : authContext.rbac.hasFederatedGraphReadAccess(federatedGraph);

    if (!allowed || authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const repo = new GraphCollectionsRepository(logger, opts.db, authContext.organizationId);
    const id = await repo.createCollection({
      federatedGraphId: federatedGraph.id,
      name,
      userId: authContext.userId,
      teamScoped: req.teamScoped,
    });

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_collection.created',
      action: 'created',
      auditableType: 'graph_collection',
      auditableDisplayName: name,
      actorId: authContext.userId,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      apiKeyName: authContext.apiKeyName,
      targetId: federatedGraph.targetId,
      targetType: 'federated_graph',
      targetDisplayName: federatedGraph.name,
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      id,
    };
  });
}
