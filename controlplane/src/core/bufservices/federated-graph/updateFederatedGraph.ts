import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
  CompositionWarning,
  DeploymentError,
  UpdateFederatedGraphRequest,
  UpdateFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabelMatchers } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateFederatedGraph(
  opts: RouterOptions,
  req: UpdateFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
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

    const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace, {
      supportsFederation: true,
    });
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.name}' not found`,
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
        targetId: federatedGraph.targetId,
        targetType: 'federatedGraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    // Do not allow changing label matchers for a contract
    if (federatedGraph.contract?.id && (req.labelMatchers.length > 0 || req.unsetLabelMatchers)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `You cannot change the label matchers for a contract graph`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (!isValidLabelMatchers(req.labelMatchers)) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_LABELS,
          details: `One or more labels in the matcher were found to be invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    if (req.admissionWebhookURL && !isValidUrl(req.admissionWebhookURL)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Admission Webhook URL is not a valid URL`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const deploymentErrors: PlainMessage<DeploymentError>[] = [];
    let compositionErrors: PlainMessage<CompositionError>[] = [];
    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

    const result = await fedGraphRepo.update({
      targetId: federatedGraph.targetId,
      labelMatchers: req.labelMatchers,
      routingUrl: req.routingUrl,
      updatedBy: authContext.userId,
      readme: req.readme,
      blobStorage: opts.blobStorage,
      namespaceId: federatedGraph.namespaceId,
      unsetLabelMatchers: req.unsetLabelMatchers,
      admissionWebhookURL: req.admissionWebhookURL,
      admissionWebhookSecret: req.admissionWebhookSecret,
      admissionConfig: {
        cdnBaseUrl: opts.cdnBaseUrl,
        jwtSecret: opts.admissionWebhookJWTSecret,
      },
      chClient: opts.chClient!,
    });

    if (result?.deploymentErrors) {
      deploymentErrors.push(...result.deploymentErrors);
    }

    if (result?.compositionErrors) {
      compositionErrors = result.compositionErrors;
    }

    if (result?.compositionWarnings) {
      compositionWarnings.push(...result.compositionWarnings);
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'federated_graph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: federatedGraph.name,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    // Send webhook event only when we update label matchers because this causes schema update
    if (result) {
      orgWebhooks.send(
        {
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: federatedGraph.id,
              name: federatedGraph.name,
              namespace: federatedGraph.namespace,
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
      compositionErrors: [],
      deploymentErrors: [],
      compositionWarnings,
    };
  });
}
