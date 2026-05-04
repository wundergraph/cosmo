import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { InviteUsersRequest, InviteUsersResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { UserInviteService } from '../../services/UserInviteService.js';

const MAXIMUM_BATCH_SIZE = 5;

export function inviteUsers(
  opts: RouterOptions,
  req: InviteUsersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<InviteUsersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<InviteUsersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    if (req.emails.length > MAXIMUM_BATCH_SIZE) {
      return {
        response: {
          code: EnumStatusCode.ERR_LIMIT_REACHED,
        },
        invitationErrors: [],
      };
    }

    const auditLogRepo = new AuditLogRepository(opts.db);

    const service = new UserInviteService({
      db: opts.db,
      logger,
      keycloakRealm: opts.keycloakRealm,
      keycloak: opts.keycloakClient,
      mailer: opts.mailerClient,
    });

    const results = await Promise.allSettled(
      req.emails.map(async (email) => {
        await service.inviteUser({
          organizationId: authContext.organizationId,
          inviterUserId: authContext.userId,
          email,
          groups: req.groups,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'organization_invitation.created',
          action: 'created',
          actorId: authContext.userId,
          auditableDisplayName: email,
          auditableType: 'user',
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });
      }),
    );

    const invitationErrors = results
      .map((result, index) => {
        if (result.status === 'rejected') {
          return {
            email: req.emails[index],
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
          };
        }
        return null;
      })
      .filter((error): error is NonNullable<typeof error> => error !== null);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      invitationErrors,
    };
  });
}
