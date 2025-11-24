import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { InviteUserRequest, InviteUserResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { UserInviteService } from '../../services/UserInviteService.js';

export function inviteUser(
  opts: RouterOptions,
  req: InviteUserRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<InviteUserResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<InviteUserResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const auditLogRepo = new AuditLogRepository(opts.db);
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const service = new UserInviteService({
      db: opts.db,
      logger,
      keycloakRealm: opts.keycloakRealm,
      keycloak: opts.keycloakClient,
      mailer: opts.mailerClient,
    });

    await service.inviteUser({
      organizationId: authContext.organizationId,
      inviterUserId: authContext.userId,
      email: req.email,
      groups: req.groups,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization_invitation.created',
      action: 'created',
      actorId: authContext.userId,
      auditableDisplayName: req.email,
      auditableType: 'user',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
        details: 'Invited member successfully.',
      },
    };
  });
}
