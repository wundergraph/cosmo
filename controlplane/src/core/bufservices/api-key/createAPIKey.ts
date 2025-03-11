import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateAPIKeyRequest, CreateAPIKeyResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { ApiKeyGenerator } from '../../services/ApiGenerator.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createAPIKey(
  opts: RouterOptions,
  req: CreateAPIKeyRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateAPIKeyResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateAPIKeyResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const apiKeyRepo = new ApiKeyRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        apiKey: '',
      };
    }

    const keyName = req.name.trim();

    const apiKeyModel = await apiKeyRepo.getAPIKeyByName({
      organizationID: authContext.organizationId,
      name: keyName,
    });
    if (apiKeyModel) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `An API key with the name ${req.name} already exists`,
        },
        apiKey: '',
      };
    }

    if (keyName.length < 3 || keyName.length > 50) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `An API key name ${req.name} does not follow the required naming rules`,
        },
        apiKey: '',
      };
    }

    const generatedAPIKey = ApiKeyGenerator.generate();

    const rbac = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'rbac',
    });

    if (rbac?.enabled) {
      if (req.allowAllResources && !authContext.isAdmin) {
        return {
          response: {
            code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
            details: `You are not authorized to perform the current action. Only admins can create an API key that has access to all resources.`,
          },
          apiKey: '',
        };
      }

      if (req.federatedGraphTargetIds.length === 0 && req.subgraphTargetIds.length === 0 && !req.allowAllResources) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Can not create an api key without associating it with any resources.`,
          },
          apiKey: '',
        };
      }

      // check if the user is authorized to perform the action
      for (const targetId of req.federatedGraphTargetIds) {
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });
      }

      for (const targetId of req.subgraphTargetIds) {
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });
      }
    }

    await apiKeyRepo.addAPIKey({
      name: keyName,
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
      key: generatedAPIKey,
      expiresAt: req.expires,
      targetIds: [...req.federatedGraphTargetIds, ...req.subgraphTargetIds],
      permissions: req.permissions,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'api_key.created',
      action: 'created',
      actorId: authContext.userId,
      auditableType: 'api_key',
      auditableDisplayName: keyName,
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      apiKey: generatedAPIKey,
    };
  });
}
