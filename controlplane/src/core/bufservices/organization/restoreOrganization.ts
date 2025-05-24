import {
  RestoreOrganizationRequest,
  RestoreOrganizationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { HandlerContext } from '@connectrpc/connect';
import { PlainMessage } from '@bufbuild/protobuf';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function restoreOrganization(
  opts: RouterOptions,
  req: RestoreOrganizationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RestoreOrganizationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RestoreOrganizationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    // Ensure that the user is an admin of the organization
    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    // Remove the queued organization deletion job
    await orgRepo.restoreOrganization({
      organizationId: org.id,
      deleteOrganizationQueue: opts.queues.deleteOrganizationQueue,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization.restored',
      action: 'restore',
      actorId: authContext.userId,
      auditableType: 'organization',
      auditableDisplayName: org.name,
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
