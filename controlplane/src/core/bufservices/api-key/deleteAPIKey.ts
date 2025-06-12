import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { DeleteAPIKeyRequest, DeleteAPIKeyResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteAPIKey(
  opts: RouterOptions,
  req: DeleteAPIKeyRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteAPIKeyResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteAPIKeyResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const apiKeyRepo = new ApiKeyRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

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

    await apiKeyRepo.removeAPIKey({
      name: req.name,
      organizationID: authContext.organizationId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
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
