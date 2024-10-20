import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
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

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
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
      };
    }

    const deploymentErrors: PlainMessage<DeploymentError>[] = [];
    let compositionErrors: PlainMessage<CompositionError>[] = [];

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
    });

    if (result?.deploymentErrors) {
      deploymentErrors.push(...result.deploymentErrors);
    }

    if (result?.compositionErrors) {
      compositionErrors = result.compositionErrors;
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'federated_graph.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: federatedGraph.name,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

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

    if (compositionErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
        },
        deploymentErrors: [],
        compositionErrors,
      };
    }

    if (deploymentErrors.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
        },
        deploymentErrors,
        compositionErrors: [],
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositionErrors: [],
      deploymentErrors: [],
    };
  });
}
