import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { DeleteUserRequest, DeleteUserResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteUser(
  opts: RouterOptions,
  req: DeleteUserRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteUserResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteUserResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db);
    const userRepo = new UserRepository(logger, opts.db);

    // Check if user can be deleted
    const { isSafe, unsafeOrganizations } = await orgRepo.canUserBeDeleted(authContext.userId);

    if (!isSafe) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details:
            'Cannot delete because you are the only admin of organizations with several members: ' +
            unsafeOrganizations.map((o) => o.name).join(',') +
            '.',
        },
      };
    }

    await opts.keycloakClient.authenticateClient();

    // Delete the user
    await userRepo.deleteUser(
      {
        id: authContext.userId,
        keycloakClient: opts.keycloakClient,
        keycloakRealm: opts.keycloakRealm,
      },
      opts.blobStorage,
      opts.queues.deleteOrganizationAuditLogsQueue,
    );

    opts.platformWebhooks.send(PlatformEventName.USER_DELETE_SUCCESS, {
      user_id: authContext.userId,
      user_email: authContext.userDisplayName,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
