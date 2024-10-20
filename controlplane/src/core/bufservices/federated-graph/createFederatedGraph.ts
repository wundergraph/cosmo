import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
  CreateFederatedGraphRequest,
  CreateFederatedGraphResponse,
  DeploymentError,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabelMatchers } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';

export function createFederatedGraph(
  opts: RouterOptions,
  req: CreateFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateFederatedGraphResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const orgWebhooks = new OrganizationWebhookService(
      opts.db,
      authContext.organizationId,
      opts.logger,
      opts.billingDefaultPlanId,
    );
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesn't have the permissions to perform this operation`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    if (await fedGraphRepo.exists(req.name, req.namespace)) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Federated graph '${req.name}' already exists in the namespace`,
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

    if (!isValidUrl(req.routingUrl)) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Routing URL is not a valid URL`,
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

    const count = await fedGraphRepo.count();

    const feature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'federated-graphs',
    });

    const limit = feature?.limit === -1 ? undefined : feature?.limit;

    if (limit && count >= limit) {
      return {
        response: {
          code: EnumStatusCode.ERR_LIMIT_REACHED,
          details: `The organization reached the limit of federated graphs`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    const federatedGraph = await fedGraphRepo.create({
      name: req.name,
      createdBy: authContext.userId,
      labelMatchers: req.labelMatchers,
      routingUrl: req.routingUrl,
      readme: req.readme,
      namespace: req.namespace,
      namespaceId: namespace.id,
      admissionWebhookURL: req.admissionWebhookURL,
      admissionWebhookSecret: req.admissionWebhookSecret,
    });

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Could not create federated graph`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    await fedGraphRepo.createGraphCryptoKeyPairs({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'federated_graph.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'federated_graph',
      auditableDisplayName: federatedGraph.name,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
      published: true,
    });

    // If there are no subgraphs, we don't need to compose anything
    // and avoid producing a version with a composition error
    if (subgraphs.length === 0) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];

    await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);

      const composition = await fedGraphRepo.composeAndDeployGraphs({
        federatedGraphs: [federatedGraph],
        actorId: authContext.userId,
        blobStorage: opts.blobStorage,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
      });

      compositionErrors.push(...composition.compositionErrors);
      deploymentErrors.push(...composition.deploymentErrors);
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
        compositionErrors,
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
