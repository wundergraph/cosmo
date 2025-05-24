import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateIntegrationConfigRequest,
  UpdateIntegrationConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateIntegrationConfig(
  opts: RouterOptions,
  req: UpdateIntegrationConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateIntegrationConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateIntegrationConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const integration = await orgRepo.getIntegration(req.id, authContext.organizationId);
    if (!integration) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Integration with id ${req.id} not found`,
        },
      };
    }

    const updatedIntegration = await orgRepo.updateIntegrationConfig({
      organizationId: authContext.organizationId,
      ...req,
    });

    if (!updatedIntegration) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Could not update configuration.`,
        },
      };
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'integration.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableType: 'integration',
      auditableDisplayName: integration.name,
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
