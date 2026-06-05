import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteFeatureFlagRequest,
  DeleteFeatureFlagResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';

export function deleteFeatureFlag(
  opts: RouterOptions,
  req: DeleteFeatureFlagRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteFeatureFlagResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteFeatureFlagResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace "${req.namespace}".`,
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

    const { deploymentErrors, compositionErrors, compositionWarnings } = await opts.db.transaction(async (tx) => {
      const auditLogRepo = new AuditLogRepository(tx);
      const featureFlagRepo = new FeatureFlagRepository(logger, tx, authContext.organizationId);
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

      const result = await compositionService.deleteFeatureFlag({
        actorId: authContext.userId,
        featureFlag,
        authorize(graph) {
          return opts.authorizer.authorize({
            db: tx,
            graph: { targetId: graph.targetId, targetType: 'federatedGraph' },
            headers: ctx.requestHeader,
            authContext,
          });
        },
      });

      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'feature_flag.deleted',
        action: 'deleted',
        actorId: authContext.userId,
        auditableType: 'feature_flag',
        auditableDisplayName: featureFlag.name,
        apiKeyName: authContext.apiKeyName,
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        targetNamespaceId: namespace.id,
        targetNamespaceDisplayName: namespace.name,
      });

      return result;
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
