import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  UpdateMonographRequest,
  UpdateMonographResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import {
  enrichLogger,
  formatSubscriptionProtocol,
  formatWebsocketSubprotocol,
  getLogger,
  handleError,
} from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateMonograph(
  opts: RouterOptions,
  req: UpdateMonographRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateMonographResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateMonographResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    return opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
      const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
      const auditLogRepo = new AuditLogRepository(tx);
      const orgWebhooks = new OrganizationWebhookService(
        tx,
        authContext.organizationId,
        opts.logger,
        opts.billingDefaultPlanId,
      );

      if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Subscription URL is not a valid URL`,
          },
          compositionErrors: [],
        };
      }

      if (req.routingUrl && !isValidUrl(req.routingUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Routing URL is not a valid URL`,
          },
          compositionErrors: [],
        };
      }

      if (req.graphUrl && !isValidUrl(req.graphUrl)) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Graph URL is not a valid URL`,
          },
          compositionErrors: [],
        };
      }

      const graph = await fedGraphRepo.byName(req.name, req.namespace, {
        supportsFederation: false,
      });
      if (!graph) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Monograph '${req.name}' not found`,
          },
          compositionErrors: [],
        };
      }

      // check whether the user is authorized to perform the action
      if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
        throw new UnauthorizedError();
      }

      const subgraphs = await subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: graph.targetId,
      });

      if (subgraphs.length === 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Monograph '${req.name}' does not have any subgraphs`,
          },
          compositionErrors: [],
        };
      }

      const subgraph = subgraphs[0];

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

      await opts.authorizer.authorize({
        db: opts.db,
        graph: {
          targetId: subgraphs[0].targetId,
          targetType: 'subgraph',
        },
        headers: ctx.requestHeader,
        authContext,
      });

      await fedGraphRepo.update({
        targetId: graph.targetId,
        labelMatchers: [],
        routingUrl: req.routingUrl,
        updatedBy: authContext.userId,
        readme: req.readme,
        blobStorage: opts.blobStorage,
        namespaceId: graph.namespaceId,
        unsetLabelMatchers: false,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          jwtSecret: opts.admissionWebhookJWTSecret,
        },
        admissionWebhookURL: req.admissionWebhookURL,
        admissionWebhookSecret: req.admissionWebhookSecret,
        chClient: opts.chClient!,
      });

      await subgraphRepo.update(
        {
          targetId: subgraph.targetId,
          labels: [],
          unsetLabels: false,
          subscriptionUrl: req.subscriptionUrl,
          routingUrl: req.graphUrl,
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
        auditAction: 'monograph.updated',
        action: 'updated',
        actorId: authContext.userId,
        auditableType: 'monograph',
        auditableDisplayName: graph.name,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: graph.namespaceId,
        targetNamespaceDisplayName: graph.namespace,
      });

      orgWebhooks.send(
        {
          eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
          payload: {
            monograph: {
              id: graph.id,
              name: graph.name,
              namespace: graph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            actor_id: authContext.userId,
          },
        },
        authContext.userId,
      );

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        compositionErrors: [],
      };
    });
  });
}
