import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { RecomposeGraphRequest, RecomposeGraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { clamp, enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuthContext, FederatedGraphDTO } from '../../../types/index.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { maxRowLimitForChecks } from '../../constants.js';
import { CompositionService } from '../../services/CompositionService.js';

export function recomposeGraph(
  opts: RouterOptions,
  req: RecomposeGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RecomposeGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RecomposeGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
      opts.webhookProxyUrl,
    );
    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    req.namespace = req.namespace || DefaultNamespace;

    const graph = await federatedGraphRepo.byName(req.name, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The ${req.isMonograph ? 'monograph' : 'federated graph'} "${req.name}" was not found in namespace "${req.namespace}".`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // Check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
      throw new UnauthorizedError();
    }

    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: graph.targetId,
        targetType: 'federatedGraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const { compositionErrors, compositionWarnings, deploymentErrors } = await opts.db.transaction((tx) => {
      const compositionService = new CompositionService(
        tx,
        authContext.organizationId,
        logger,
        { cdnBaseUrl: opts.cdnBaseUrl, webhookJWTSecret: opts.admissionWebhookJWTSecret },
        opts.blobStorage,
        opts.chClient,
        opts.webhookProxyUrl,
        req.disableResolvabilityValidation,
      );

      return compositionService.composeAndDeployFederatedGraph({ actorId: authContext.userId, federatedGraph: graph });
    });

    sendOrgWebhooks({
      authContext,
      graph,
      hasErrors: compositionErrors.length > 0 || deploymentErrors.length > 0,
      isMonograph: req.isMonograph,
      orgWebhooks,
    });

    const auditLogRepo = new AuditLogRepository(opts.db);
    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: req.isMonograph ? 'monograph.recomposed' : 'federated_graph.recomposed',
      action: 'recomposed',
      actorId: authContext.userId,
      auditableType: req.isMonograph ? 'monograph' : 'federated_graph',
      auditableDisplayName: graph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: graph.namespaceId,
      targetNamespaceDisplayName: graph.namespace,
    });

    // If req.limit is not provided, use maxRowLimitForChecks as default
    const boundedLimit = req.limit === undefined ? maxRowLimitForChecks : clamp(req.limit, 1, maxRowLimitForChecks);

    const boundedCompositionErrors = compositionErrors.slice(0, boundedLimit);
    const boundedCompositionWarnings = compositionWarnings.slice(0, boundedLimit);
    const boundedDeploymentErrors = deploymentErrors.slice(0, boundedLimit);

    const errorCounts = {
      compositionErrors: compositionErrors.length,
      compositionWarnings: compositionWarnings.length,
      deploymentErrors: deploymentErrors.length,
    };

    if (boundedCompositionErrors.length > 0) {
      return {
        compositionErrors: boundedCompositionErrors,
        compositionWarnings: boundedCompositionWarnings,
        deploymentErrors: boundedDeploymentErrors,
        errorCounts,
        response: {
          code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
        },
      };
    }

    if (boundedDeploymentErrors.length > 0) {
      return {
        compositionErrors: [],
        compositionWarnings: boundedCompositionWarnings,
        deploymentErrors: boundedDeploymentErrors,
        errorCounts,
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
      };
    }

    return {
      compositionErrors: [],
      compositionWarnings: boundedCompositionWarnings,
      deploymentErrors: [],
      errorCounts,
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}

type SendOrgWebhooksParams = {
  authContext: AuthContext;
  graph: FederatedGraphDTO;
  hasErrors: boolean;
  isMonograph: boolean;
  orgWebhooks: OrganizationWebhookService;
};

function sendOrgWebhooks({ authContext, graph, hasErrors, isMonograph, orgWebhooks }: SendOrgWebhooksParams) {
  if (isMonograph) {
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
    return;
  }
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
        actor_id: authContext.userId,
        errors: hasErrors,
      },
    },
    authContext.userId,
  );
}
