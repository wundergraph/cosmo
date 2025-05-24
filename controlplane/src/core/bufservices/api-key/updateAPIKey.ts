import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { UpdateAPIKeyRequest, UpdateAPIKeyResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateAPIKey(
  opts: RouterOptions,
  req: UpdateAPIKeyRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateAPIKeyResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateAPIKeyResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const apiKeyRepo = new ApiKeyRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const apiKey = await apiKeyRepo.getAPIKeyByName({ organizationID: authContext.organizationId, name: req.name });
    if (!apiKey) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `An API key with the name ${req.name} doesnt exists`,
        },
      };
    }

    if (!authContext.rbac.isOrganizationApiKeyManager) {
      throw new UnauthorizedError();
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
      };
    }

    await apiKeyRepo.updateAPIKeyGroup({ apiKeyId: apiKey.id, groupId: orgGroup.groupId });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'api_key.group_updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'api_key_group',
      auditableDisplayName: orgGroup.name,
      actorDisplayName: authContext.userDisplayName,
      targetId: apiKey.id,
      targetType: 'api_key',
      targetDisplayName: apiKey.name,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
