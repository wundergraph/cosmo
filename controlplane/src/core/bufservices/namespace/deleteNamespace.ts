import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateNamespaceRequest,
  DeleteNamespaceResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteNamespace(
  opts: RouterOptions,
  req: CreateNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db);

    if (req.name === DefaultNamespace) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'You cannot delete the default namespace',
        },
      };
    }

    const ns = await namespaceRepo.byName(req.name);
    if (!ns) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'The namespace was not found',
        },
      };
    }

    const orgMember = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: authContext.userId,
    });

    if (!orgMember) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    // Ensure that only creator and admin can delete a namespace because it will delete all underlying resources
    if (ns.createdBy !== authContext.userId && !orgMember.roles.includes('admin')) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User does not have the permissions to delete the namespace.',
        },
      };
    }

    await opts.db.transaction(async (tx) => {
      const federatedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);
      const auditLogRepo = new AuditLogRepository(tx);

      const federatedGraphs = await federatedGraphRepo.list({
        namespaceId: ns.id,
        offset: 0,
        limit: 0,
      });

      const subgraphs = await subgraphRepo.list({
        namespaceId: ns.id,
        offset: 0,
        limit: 0,
        excludeFeatureSubgraphs: false,
      });

      await namespaceRepo.delete(req.name);

      for (const federatedGraph of federatedGraphs) {
        const blobStorageDirectory = `${authContext.organizationId}/${federatedGraph.id}`;
        await opts.blobStorage.removeDirectory({
          key: blobStorageDirectory,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: federatedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: federatedGraph.namespaceId,
          targetNamespaceDisplayName: federatedGraph.namespace,
        });
      }

      for (const subgraph of subgraphs) {
        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: subgraph.isFeatureSubgraph ? 'feature_subgraph.deleted' : 'subgraph.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: subgraph.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
          auditableDisplayName: subgraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });
      }

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        auditAction: 'namespace.deleted',
        action: 'deleted',
        actorId: authContext.userId,
        auditableType: 'namespace',
        auditableDisplayName: ns.name,
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
