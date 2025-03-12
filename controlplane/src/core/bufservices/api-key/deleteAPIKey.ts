import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { DeleteAPIKeyRequest, DeleteAPIKeyResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteAPIKey(
  opts: RouterOptions,
  req: DeleteAPIKeyRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteAPIKeyResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteAPIKeyResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const apiKeyRepo = new ApiKeyRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
      };
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

    const userRoles = await orgRepo.getOrganizationMemberRoles({
      userID: authContext.userId || '',
      organizationID: authContext.organizationId,
    });

    if (!(apiKey.creatorUserID === authContext.userId || userRoles.includes('admin'))) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `You are not authorized to delete the api key '${apiKey.name}'`,
        },
      };
    }

    await apiKeyRepo.removeAPIKey({
      name: req.name,
      organizationID: authContext.organizationId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'api_key.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      auditableType: 'api_key',
      auditableDisplayName: apiKey.name,
      actorDisplayName: authContext.userDisplayName,
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
