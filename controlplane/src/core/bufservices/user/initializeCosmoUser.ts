import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  InitializeCosmoUserRequest,
  InitializeCosmoUserResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { getLogger, handleError } from '../../util.js';
import AuthUtils from '../../auth-utils.js';

export function initializeCosmoUser(
  opts: RouterOptions,
  req: InitializeCosmoUserRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<InitializeCosmoUserResponse>> {
  const logger = getLogger(ctx, opts.logger);
  return handleError<PlainMessage<InitializeCosmoUserResponse>>(ctx, logger, async () => {
    const userInfo = await opts.authenticator.getUserInfo(req.token);
    if (!userInfo) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
        },
      };
    }

    // We don't care about the result of the callback
    await AuthUtils.handleAuthCallback({
      db: opts.db,
      keycloakClient: opts.keycloakClient,
      keycloakRealm: opts.keycloakRealm,
      tokenPayload: userInfo,
      platformWebhooks: opts.platformWebhooks,
      logger,
      defaultBillingPlanId: opts.billingDefaultPlanId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
