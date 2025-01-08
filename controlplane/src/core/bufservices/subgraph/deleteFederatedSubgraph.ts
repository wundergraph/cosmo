import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  DeleteFederatedSubgraphRequest,
  DeleteFederatedSubgraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';

export function deleteFederatedSubgraph(
  opts: RouterOptions,
  req: DeleteFederatedSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteFederatedSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteFederatedSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.subgraphName}" was not found.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check if the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraph.targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const { affectedFederatedGraphs, compositionErrors, deploymentErrors, compositionWarnings } =
      await opts.db.transaction(async (tx) => {
        const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
        const featureFlagRepo = new FeatureFlagRepository(logger, tx, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(tx);

        let labels = subgraph.labels;
        if (subgraph.isFeatureSubgraph) {
          const baseSubgraph = await featureFlagRepo.getBaseSubgraphByFeatureSubgraphId({ id: subgraph.id });
          if (baseSubgraph) {
            labels = baseSubgraph.labels;
          }
        } else {
          await featureFlagRepo.deleteFeatureSubgraphsByBaseSubgraphId({
            subgraphId: subgraph.id,
            namespaceId: subgraph.namespaceId,
          });
        }

        // Collect all federated graphs that used this subgraph before deleting subgraph to include them in the composition
        const affectedFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
          labels,
          namespaceId: subgraph.namespaceId,
          excludeContracts: true,
        });

        // Delete the subgraph
        await subgraphRepo.delete(subgraph.targetId);

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

        // Recompose and deploy all affected federated graphs and their respective contracts.
        // Collects all composition and deployment errors if any.
        const { compositionErrors, deploymentErrors, compositionWarnings } = await fedGraphRepo.composeAndDeployGraphs({
          federatedGraphs: affectedFederatedGraphs,
          blobStorage: opts.blobStorage,
          admissionConfig: {
            webhookJWTSecret: opts.admissionWebhookJWTSecret,
            cdnBaseUrl: opts.cdnBaseUrl,
          },
          actorId: authContext.userId,
          chClient: opts.chClient!,
        });

        return { affectedFederatedGraphs, compositionErrors, deploymentErrors, compositionWarnings };
      });

    for (const affectedFederatedGraph of affectedFederatedGraphs) {
      const hasErrors =
        compositionErrors.some((error) => error.federatedGraphName === affectedFederatedGraph.name) ||
        deploymentErrors.some((error) => error.federatedGraphName === affectedFederatedGraph.name);
      orgWebhooks.send(
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: affectedFederatedGraph.id,
              name: affectedFederatedGraph.name,
              namespace: affectedFederatedGraph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: hasErrors,
            actor_id: authContext.userId,
          },
        },
        authContext.userId,
      );
    }

    if (compositionErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
        },
        deploymentErrors: [],
        compositionErrors,
        compositionWarnings,
      };
    }

    if (deploymentErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
        deploymentErrors,
        compositionErrors: [],
        compositionWarnings,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      deploymentErrors: [],
      compositionErrors: [],
      compositionWarnings,
    };
  });
}
