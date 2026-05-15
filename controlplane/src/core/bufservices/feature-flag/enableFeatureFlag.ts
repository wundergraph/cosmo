import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  EnableFeatureFlagRequest,
  EnableFeatureFlagResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';

export function enableFeatureFlag(
  opts: RouterOptions,
  req: EnableFeatureFlagRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<EnableFeatureFlagResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<EnableFeatureFlagResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

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

    const featureFlag = await featureFlagRepo.getFeatureFlagByName({
      featureFlagName: req.name,
      namespaceId: namespace.id,
    });
    if (!featureFlag) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The feature flag "${req.name}" was not found.`,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFeatureFlagWriteAccess(featureFlag)) {
      throw new UnauthorizedError();
    }

    if (featureFlag.isEnabled === req.enabled) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
        hasChanged: false,
      };
    }

    const { deploymentErrors, compositionErrors, compositionWarnings } = await opts.db.transaction(async (tx) => {
      const txFeatureFlagRepo = new FeatureFlagRepository(logger, tx, authContext.organizationId);
      await txFeatureFlagRepo.enableFeatureFlag({
        featureFlagId: featureFlag.id,
        namespaceId: namespace.id,
        isEnabled: req.enabled,
      });

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
        isEnabled: req.enabled,
      });
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: req.enabled ? 'feature_flag.enabled' : 'feature_flag.disabled',
      action: req.enabled ? 'enabled' : 'disabled',
      actorId: authContext.userId,
      auditableType: 'feature_flag',
      auditableDisplayName: featureFlag.name,
      apiKeyName: authContext.apiKeyName,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      targetNamespaceId: featureFlag.namespaceId,
      targetNamespaceDisplayName: featureFlag.namespace,
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
      hasChanged: true,
    };
  });
}
