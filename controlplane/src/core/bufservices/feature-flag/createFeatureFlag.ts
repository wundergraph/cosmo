import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateFeatureFlagRequest,
  CreateFeatureFlagResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabels } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';

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

    const createdFeatureFlag = await featureFlagRepo.getFeatureFlagById({
      featureFlagId: featureFlag.id,
      namespaceId: namespace.id,
      includeSubgraphs: true,
    });

    if (!createdFeatureFlag) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Feature flag "${featureFlag.name}" was not found after creation.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    const { deploymentErrors, compositionErrors, compositionWarnings } = await opts.db.transaction((tx) => {
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

      return compositionService.composeAndDeployFeatureFlag({
        actorId: authContext.userId,
        featureFlag: createdFeatureFlag,
      });
    });

    return {
      response: {
        code:
          compositionErrors.length > 0
            ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
            : deploymentErrors.length > 0
              ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
              : EnumStatusCode.OK,
      },
      compositionErrors,
      deploymentErrors,
      compositionWarnings,
    };
  });
}
