import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateFeatureFlagRequest,
  UpdateFeatureFlagResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabels, normalizeLabels } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { CompositionService } from '../../services/CompositionService.js';
import { CompositionBlobStorageQueue } from '../../services/CompositionBlobStorageQueue.js';
import { ComposeAndDeployResult } from '../../../types/index.js';

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

    // Determine whether the request actually changes anything. The update only touches the labels
    // (when labels are provided or unsetLabels is set) and the feature subgraph set (when feature
    // subgraph names are provided). If neither differs from what is currently stored, there is
    // nothing to recompose, so we skip the write and composition entirely.
    let labelsChanged = false;
    const currentLabels = normalizeLabels(featureFlagDTO.labels).map((l) => joinLabel(l));
    if (req.unsetLabels) {
      labelsChanged = currentLabels.length > 0;
    } else if (req.labels.length > 0) {
      const newLabels = normalizeLabels(req.labels).map((l) => joinLabel(l));
      labelsChanged =
        currentLabels.length !== newLabels.length || currentLabels.some((label) => !newLabels.includes(label));
    }

    let featureSubgraphsChanged = false;
    if (featureSubgraphIds.length > 0) {
      const currentFeatureSubgraphIds = new Set(featureFlagDTO.featureSubgraphs.map((fs) => fs.id));
      featureSubgraphsChanged =
        featureSubgraphIds.length !== currentFeatureSubgraphIds.size ||
        featureSubgraphIds.some((id) => !currentFeatureSubgraphIds.has(id));
    }

    if (!labelsChanged && !featureSubgraphsChanged) {
      const auditLogRepo = new AuditLogRepository(opts.db);
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

    const prevFederatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlagDTO.id,
      namespaceId: namespace.id,
      excludeDisabled: true,
    });

    const cbsq = new CompositionBlobStorageQueue(
      logger,
      opts.db,
      opts.blobStorage,
      authContext.organizationId,
      { cdnBaseUrl: opts.cdnBaseUrl, webhookJWTSecret: opts.admissionWebhookJWTSecret },
      opts.chClient,
      opts.webhookProxyUrl,
    );

    const { deploymentErrors, compositionErrors, compositionWarnings, notFoundError } = await opts.db.transaction(
      async (tx) => {
        const txFeatureFlagRepo = new FeatureFlagRepository(logger, tx, authContext.organizationId);
        await txFeatureFlagRepo.updateFeatureFlag({
          featureFlag: featureFlagDTO,
          labels: req.labels,
          featureSubgraphIds,
          unsetLabels: req.unsetLabels ?? false,
        });

        const auditLogRepo = new AuditLogRepository(tx);
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

        const updatedFeatureFlag = await txFeatureFlagRepo.getFeatureFlagById({
          featureFlagId: featureFlagDTO.id,
          namespaceId: namespace.id,
          includeSubgraphs: true,
        });

        if (!updatedFeatureFlag) {
          return {
            compositionErrors: [],
            deploymentErrors: [],
            compositionWarnings: [],
            notFoundError: `Feature flag "${featureFlagDTO.name}" was not found after updating.`,
          } as ComposeAndDeployResult & { notFoundError: string };
        }

        const compositionService = new CompositionService(
          tx,
          authContext.organizationId,
          logger,
          cbsq,
          opts.chClient,
          opts.webhookProxyUrl,
          req.disableResolvabilityValidation,
        );

        const compositionResult = await compositionService.composeAndDeployFeatureFlag({
          actorId: authContext.userId,
          featureFlag: updatedFeatureFlag,
          prevFederatedGraphs,
        });

        return {
          deploymentErrors: compositionResult.deploymentErrors,
          compositionErrors: compositionResult.compositionErrors,
          compositionWarnings: compositionResult.compositionWarnings,
          notFoundError: undefined,
        };
      },
    );

    if (notFoundError) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: notFoundError,
        },
        compositionErrors: [],
        deploymentErrors: [],
        compositionWarnings: [],
      };
    }

    deploymentErrors.push(...(await cbsq.drainQueue()));

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
