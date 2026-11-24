import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  DeleteFederatedGraphRequest,
  DeleteFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage, FederatedGraphDTO } from '../../../types/index.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { sendGraphLifecycle } from '../../webhooks/graphLifecycleWebhook.js';

export function deleteFederatedGraph(
  opts: RouterOptions,
  req: DeleteFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const deletedGraphs: FederatedGraphDTO[] = [];

    const result = await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const auditLogRepo = new AuditLogRepository(tx);
      const contractRepo = new ContractRepository(logger, tx, authContext.organizationId);

      req.namespace = req.namespace || DefaultNamespace;
      if (authContext.organizationDeactivated) {
        throw new UnauthorizedError();
      }

      const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace, {
        supportsFederation: true,
      });

      if (!federatedGraph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Federated graph '${req.name}' not found`,
          },
        };
      }

      // check if the user is authorized to perform the action
      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: federatedGraph.targetId,
          targetType: 'federatedGraph',
        },
        headers: ctx.requestHeader,
        authContext,
        isDeleteOperation: true,
      });

      const deletedContracts = await contractRepo.deleteContractGraphs(federatedGraph.id);
      await fedGraphRepo.delete(federatedGraph.targetId);

      deletedGraphs.push(federatedGraph, ...deletedContracts);

      for (const deletedGraph of deletedGraphs) {
        const blobStorageDirectory = `${authContext.organizationId}/${deletedGraph.id}`;
        await opts.blobStorage.removeDirectory({ key: blobStorageDirectory });
      }

      for (const deletedGraph of deletedGraphs) {
        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'federated_graph.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: deletedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: deletedGraph.namespaceId,
          targetNamespaceDisplayName: deletedGraph.namespace,
        });
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });

    for (const deletedGraph of deletedGraphs) {
      sendGraphLifecycle(opts, {
        eventName: OrganizationEventName.GRAPH_DELETED,
        authContext,
        graph: { id: deletedGraph.id, name: deletedGraph.name, namespace: deletedGraph.namespace, type: 'federated' },
      });
    }

    return result;
  });
}
