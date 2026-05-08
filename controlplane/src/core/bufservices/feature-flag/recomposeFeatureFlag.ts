import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RecomposeFeatureFlagRequest,
  RecomposeFeatureFlagResponse
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';
import { FeatureFlagRepository } from "../../repositories/FeatureFlagRepository.js";
import { OrganizationRepository } from "../../repositories/OrganizationRepository.js";

export function recomposeFeatureFlag(
  opts: RouterOptions,
  req: RecomposeFeatureFlagRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RecomposeFeatureFlagResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RecomposeFeatureFlagResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);

    // Make sure that the config splitting is enabled for the organization
    const feature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'split-config-loading',
    });

    if (!feature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Configuration splitting not enabled',
        },
        deploymentErrors: [],
        compositionErrors: [],
        compositionWarnings: [],
      };
    }

    // Validate that the namespace exists for the organization
    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        deploymentErrors: [],
        compositionErrors: [],
        compositionWarnings: [],
      };
    }

    // Validate that the feature flag exists in the namespace
    const featureFlag = await featureFlagRepo.getFeatureFlagByName({
      featureFlagName: req.name,
      namespaceId: namespace.id,
    });

    if (!featureFlag) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The feature flag "${req.name}" was not found`,
        },
        deploymentErrors: [],
        compositionErrors: [],
        compositionWarnings: [],
      };
    }

    if (!authContext.rbac.hasFeatureFlagWriteAccess(featureFlag)) {
      throw new UnauthorizedError();
    }

    // Compose and deploy the feature flag
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
        featureFlag,
      });
    });

    return {
      response: {
        code: compositionErrors.length > 0
          ? EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
          : deploymentErrors.length > 0
            ? EnumStatusCode.ERR_DEPLOYMENT_FAILED
            : EnumStatusCode.OK
      },
      deploymentErrors,
      compositionErrors,
      compositionWarnings,
    };
  });
}