import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteOrganizationWebhookConfigRequest,
  DeleteOrganizationWebhookConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteOrganizationWebhookConfig(
  opts: RouterOptions,
  req: DeleteOrganizationWebhookConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOrganizationWebhookConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOrganizationWebhookConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    if (!req.id) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Webhook config id is required`,
        },
      };
    }

    const webhook = await orgRepo.getWebhookConfigById(req.id, authContext.organizationId);
    if (!webhook) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Webhook config not found`,
        },
      };
    }

    const config = await orgRepo.deleteWebhookConfig({
      organizationId: authContext.organizationId,
      id: req.id,
    });

    if (!config) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Webhook config could not be deleted`,
        },
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'webhook_config.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      auditableType: 'webhook_config',
      auditableDisplayName: config.endpoint || '',
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
