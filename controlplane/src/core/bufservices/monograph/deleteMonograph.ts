import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteMonographRequest,
  DeleteMonographResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphDTO } from '../../../types/index.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { ContractRepository } from '../../repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteMonograph(
  opts: RouterOptions,
  req: DeleteMonographRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteMonographResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteMonographResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    return await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const contractRepo = new ContractRepository(logger, tx, authContext.organizationId);
      const auditLogRepo = new AuditLogRepository(tx);

      if (authContext.organizationDeactivated) {
        throw new UnauthorizedError();
      }

      const graph = await fedGraphRepo.byName(req.name, req.namespace, {
        supportsFederation: false,
      });

      if (!graph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Graph '${req.name}' not found`,
          },
        };
      }

      // check if the user is authorized to perform the action
      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: graph.targetId,
          targetType: 'federatedGraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });

      const subgraphs = await subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: graph.targetId,
      });

      const deletedContracts = await contractRepo.deleteContractGraphs(graph.id);
      await fedGraphRepo.delete(graph.targetId);

      const deletedGraphs: FederatedGraphDTO[] = [graph, ...deletedContracts];

      for (const deletedGraph of deletedGraphs) {
        const blobStorageDirectory = `${authContext.organizationId}/${deletedGraph.id}`;
        await opts.blobStorage.removeDirectory({ key: blobStorageDirectory });
      }

      if (subgraphs.length === 1) {
        await subgraphRepo.delete(subgraphs[0].targetId);
      }

      for (const deletedGraph of deletedGraphs) {
        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'monograph.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'monograph',
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
  });
}
