import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
  CompositionWarning,
  CreateFeatureFlagRequest,
  CreateFeatureFlagResponse,
  DeploymentError,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabels } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createFeatureFlag(
  opts: RouterOptions,
  req: CreateFeatureFlagRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateFeatureFlagResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateFeatureFlagResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
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

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find the namespace "${req.namespace}".`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.canCreateFeatureFlag(namespace)) {
      throw new UnauthorizedError();
    }

    const feature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'feature-flags',
    });

    const limit = feature?.limit === -1 ? undefined : feature?.limit;

    if (limit !== undefined && limit !== null) {
      const count = await featureFlagRepo.count(authContext.organizationId);

      if (count >= limit) {
        return {
          response: {
            code: EnumStatusCode.ERR_LIMIT_REACHED,
            details:
              `The organization "${authContext.organizationSlug}" has already reached its limit of` +
              ` ${limit} feature flag${limit === 1 ? '' : 's'}.`,
          },
          compositionErrors: [],
          deploymentErrors: [],
          compositionWarnings: [],
        };
      }
    }

    if (req.featureSubgraphNames.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `At least one feature subgraph is required to create a feature flag.`,
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
          details: `One or more labels were found to be invalid`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const existingFeatureFlag = await featureFlagRepo.getFeatureFlagByName({
      featureFlagName: req.name,
      namespaceId: namespace.id,
    });
    if (existingFeatureFlag) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `The feature flag "${req.name}" already exists in the namespace "${namespace.name}".`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const { errorMessages, featureSubgraphIds } = await featureFlagRepo.checkConstituentFeatureSubgraphs({
      featureSubgraphNames: req.featureSubgraphNames,
      namespace: namespace.name,
    });

    if (errorMessages.length > 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: errorMessages.join('\n'),
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const auditLogRepo = new AuditLogRepository(opts.db);

    const featureFlag = await featureFlagRepo.createFeatureFlag({
      namespaceId: namespace.id,
      name: req.name,
      labels: req.labels,
      featureSubgraphIds,
      createdBy: authContext.userId,
      isEnabled: req.isEnabled,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'feature_flag.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'feature_flag',
      auditableDisplayName: featureFlag.name,
      apiKeyName: authContext.apiKeyName,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: namespace.id,
      targetNamespaceDisplayName: namespace.name,
    });

    // If the feature flag was not created with -e or --enabled, there is nothing further to do
    if (!req.isEnabled) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const federatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlag.id,
      namespaceId: namespace.id,
      excludeDisabled: true,
    });

    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];
    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

    await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);

      const composition = await fedGraphRepo.composeAndDeployGraphs({
        federatedGraphs,
        actorId: authContext.userId,
        blobStorage: opts.blobStorage,
        admissionConfig: {
          cdnBaseUrl: opts.cdnBaseUrl,
          webhookJWTSecret: opts.admissionWebhookJWTSecret,
        },
        chClient: opts.chClient!,
      });

      compositionErrors.push(...composition.compositionErrors);
      deploymentErrors.push(...composition.deploymentErrors);
      compositionWarnings.push(...composition.compositionWarnings);
    });

    for (const graph of federatedGraphs) {
      const hasErrors =
        compositionErrors.some((error) => error.federatedGraphName === graph.name) ||
        deploymentErrors.some((error) => error.federatedGraphName === graph.name);
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
        compositionErrors,
        deploymentErrors: [],
        compositionWarnings,
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
      compositionErrors,
      deploymentErrors,
      compositionWarnings,
    };
  });
}
