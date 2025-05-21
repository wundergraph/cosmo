import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CreateAPIKeyRequest, CreateAPIKeyResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { ApiKeyGenerator } from '../../services/ApiGenerator.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

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
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationApiKeyManager) {
      throw new UnauthorizedError();
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

    const orgGroup = await orgGroupRepo.byId({
      organizationId: authContext.organizationId,
      groupId: req.groupId,
    });

    if (!orgGroup) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Group not found',
        },
        apiKey: '',
      };
    }

    const generatedAPIKey = ApiKeyGenerator.generate();

    await apiKeyRepo.addAPIKey({
      name: keyName,
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
      key: generatedAPIKey,
      expiresAt: req.expires,
      groupId: orgGroup.groupId,
      permissions: req.permissions,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
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
