import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { MoveGraphRequest, MoveGraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PublicError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';

export function moveSubgraph(
  opts: RouterOptions,
  req: MoveGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<MoveGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<MoveGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );

    const subgraph = await subgraphRepo.byName(req.name, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.name}" was not found.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (subgraph.isFeatureSubgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Feature subgraphs cannot be moved.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const featureSubgraphs = await featureFlagRepo.getFeatureSubgraphsByBaseSubgraphId({
      baseSubgraphId: subgraph.id,
    });
    if (featureSubgraphs.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Subgraphs that form the base of one or more feature subgraphs cannot be moved.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: subgraph.targetId,
        targetType: 'subgraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const { compositionErrors, updatedFederatedGraphs, deploymentErrors, compositionWarnings } =
      await opts.db.transaction(async (tx) => {
        const auditLogRepo = new AuditLogRepository(tx);
        const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
        const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);

        const exists = await subgraphRepo.exists(req.name, req.newNamespace);
        if (exists) {
          throw new PublicError(
            EnumStatusCode.ERR_ALREADY_EXISTS,
            `The subgraph "${req.name}" already exists in the namespace "${req.newNamespace}".`,
          );
        }

        const newNamespace = await namespaceRepo.byName(req.newNamespace);
        if (!newNamespace) {
          throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Could not find namespace ${req.newNamespace}`);
        }

        const { compositionErrors, updatedFederatedGraphs, deploymentErrors, compositionWarnings } =
          await subgraphRepo.move(
            {
              targetId: subgraph.targetId,
              updatedBy: authContext.userId,
              subgraphId: subgraph.id,
              subgraphLabels: subgraph.labels,
              currentNamespaceId: subgraph.namespaceId,
              newNamespaceId: newNamespace.id,
            },
            opts.blobStorage,
            {
              cdnBaseUrl: opts.cdnBaseUrl,
              jwtSecret: opts.admissionWebhookJWTSecret,
            },
            opts.chClient!,
          );

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'subgraph.moved',
          action: 'moved',
          actorId: authContext.userId,
          auditableType: 'subgraph',
          auditableDisplayName: subgraph.name,
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: newNamespace.id,
          targetNamespaceDisplayName: newNamespace.name,
        });

        return { compositionErrors, updatedFederatedGraphs, deploymentErrors, compositionWarnings };
      });

    for (const graph of updatedFederatedGraphs) {
      orgWebhooks.send(
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: graph.id,
              name: graph.name,
              namespace: graph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
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
        compositionErrors,
        compositionWarnings,
        deploymentErrors: [],
      };
    }

    if (deploymentErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
        compositionErrors: [],
        deploymentErrors,
        compositionWarnings,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositionErrors: [],
      deploymentErrors: [],
      compositionWarnings,
    };
  });
}
