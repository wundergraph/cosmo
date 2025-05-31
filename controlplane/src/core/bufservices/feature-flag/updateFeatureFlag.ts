import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  CompositionError,
  CompositionWarning,
  DeploymentError,
  UpdateFeatureFlagRequest,
  UpdateFeatureFlagResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphDTO } from '../../../types/index.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabels } from '../../util.js';
import { OrganizationWebhookService } from '../../webhooks/OrganizationWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateFeatureFlag(
  opts: RouterOptions,
  req: UpdateFeatureFlagRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateFeatureFlagResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateFeatureFlagResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
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
          details: `Could not find namespace ${req.namespace}`,
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

    const featureFlagDTO = await featureFlagRepo.getFeatureFlagByName({
      featureFlagName: req.name,
      namespaceId: namespace.id,
    });
    if (!featureFlagDTO) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The feature flag "${req.name}" does not exist in the namespace "${req.namespace}".`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFeatureFlagWriteAccess(featureFlagDTO)) {
      throw new UnauthorizedError();
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

    const allFederatedGraphsToCompose: FederatedGraphDTO[] = [];
    const allFederatedGraphIdsToCompose = new Set<string>();

    const prevFederatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlagDTO.id,
      namespaceId: namespace.id,
      excludeDisabled: true,
    });

    for (const prevFederatedGraph of prevFederatedGraphs) {
      allFederatedGraphIdsToCompose.add(prevFederatedGraph.id);
      allFederatedGraphsToCompose.push(prevFederatedGraph);
    }

    await featureFlagRepo.updateFeatureFlag({
      featureFlag: featureFlagDTO,
      labels: req.labels,
      featureSubgraphIds,
      unsetLabels: req.unsetLabels ?? false,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'feature_flag.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'feature_flag',
      auditableDisplayName: featureFlagDTO.name,
      apiKeyName: authContext.apiKeyName,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: namespace.id,
      targetNamespaceDisplayName: namespace.name,
    });

    const newFederatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlagDTO.id,
      namespaceId: namespace.id,
      excludeDisabled: true,
    });

    for (const newFederatedGraph of newFederatedGraphs) {
      if (allFederatedGraphIdsToCompose.has(newFederatedGraph.id)) {
        continue;
      }
      allFederatedGraphsToCompose.push(newFederatedGraph);
    }

    const compositionErrors: PlainMessage<CompositionError>[] = [];
    const deploymentErrors: PlainMessage<DeploymentError>[] = [];
    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];

    await opts.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);

      const composition = await fedGraphRepo.composeAndDeployGraphs({
        federatedGraphs: allFederatedGraphsToCompose,
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

    for (const graph of allFederatedGraphsToCompose) {
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
