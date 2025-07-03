import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { UpdateSubgraphRequest, UpdateSubgraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  enrichLogger,
  formatSubscriptionProtocol,
  formatWebsocketSubprotocol,
  getLogger,
  handleError,
  isValidLabels,
} from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateSubgraph(
  opts: RouterOptions,
  req: UpdateSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

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

    if (subgraph.isFeatureSubgraph && ((req.labels && req.labels.length > 0) || req.unsetLabels)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            `Feature subgraph labels cannot be changed directly.` +
            ` Feature subgraph labels are determined by the feature flag they compose.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!isValidLabels(req.labels)) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_LABELS,
          details: `One ore more labels were found to be invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // If the graph is an EDG, it should never define a routing URL nor a subscription URL
    if (subgraph.isEventDrivenGraph) {
      if (req.routingUrl !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Event-Driven Graphs must not define a routing URL`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
      if (req.subscriptionUrl !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Event-Driven Graphs must not define a subscription URL`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
      if (req.subscriptionProtocol !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Event-Driven Graphs must not define a subscription protocol`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
      if (req.websocketSubprotocol !== undefined) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Event-Driven Graphs must not define a websocket subprotocol`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
    } else {
      // Routing URL should never be an empty string, so check explicitly for undefined
      if (req.routingUrl !== undefined && !isValidUrl(req.routingUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Routing URL "${req.routingUrl}" is not a valid URL.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
      // When un-setting the url, the url can be an empty string
      if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Subscription URL "${req.subscriptionUrl}" is not a valid URL.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
    }

    // Check if the user is authorized to perform the action
    if (!authContext.rbac.canUpdateSubGraph(subgraph)) {
      throw new UnauthorizedError();
    }

    const { compositionErrors, updatedFederatedGraphs, deploymentErrors, compositionWarnings } =
      await subgraphRepo.update(
        {
          targetId: subgraph.targetId,
          labels: req.labels,
          unsetLabels: req.unsetLabels ?? false,
          subscriptionUrl: req.subscriptionUrl,
          routingUrl: req.routingUrl,
          subscriptionProtocol:
            req.subscriptionProtocol === undefined ? undefined : formatSubscriptionProtocol(req.subscriptionProtocol),
          websocketSubprotocol:
            req.websocketSubprotocol === undefined ? undefined : formatWebsocketSubprotocol(req.websocketSubprotocol),
          updatedBy: authContext.userId,
          readme: req.readme,
          namespaceId: subgraph.namespaceId,
        },
        opts.blobStorage,
        {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        opts.chClient!,
      );

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: subgraph.isFeatureSubgraph ? 'feature_subgraph.updated' : 'subgraph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: subgraph.isFeatureSubgraph ? 'feature_subgraph' : 'subgraph',
      auditableDisplayName: subgraph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: subgraph.namespaceId,
      targetNamespaceDisplayName: subgraph.namespace,
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
        compositionWarnings,
        deploymentErrors,
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
