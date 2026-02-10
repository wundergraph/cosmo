import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  InitializeCosmoUserRequest,
  InitializeCosmoUserResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { JWTPayload } from 'jose';
import type { RouterOptions } from '../../routes.js';
import { getLogger, handleError } from '../../util.js';
import AuthUtils from '../../auth-utils.js';
import { CustomAccessTokenClaims } from '../../../types/index.js';

export function initializeCosmoUser(
  opts: RouterOptions,
  req: InitializeCosmoUserRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<InitializeCosmoUserResponse>> {
  const logger = getLogger(ctx, opts.logger);
  return handleError<PlainMessage<InitializeCosmoUserResponse>>(ctx, logger, async () => {
    // We are omitting the authentication logic here as it would cause an `Unauthenticated` error if the user doesn't
    // exist in the database, which the goal of this RPC is to make sure that the user is created to begin with;
    // instead, we are relying on the `token` provided by the request, if the token is missing, expired or
    // otherwise invalid, we return a failure response.
    const token = req.token.trim();
    if (!token || /^cosmo_/i.test(token)) {
      // Either the token is completely empty (maybe just whitespaces) or the token seem to be an API key
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
        },
      };
    }

    // Ensure that the token was signed by our Keycloak instance and hasn't been tampered
    let tokenPayload: (CustomAccessTokenClaims & JWTPayload) | undefined;
    try {
      tokenPayload = await opts.keycloakClient.verifyToken({ token, realm: opts.keycloakRealm });
    } catch (error: unknown) {
      logger.error(error, 'Token validation failed');
    }

    // Ensure that the token is valid
    if (
      !tokenPayload ||
      tokenPayload.iss !== `${opts.keycloakClient.client.baseUrl}/realms/${opts.keycloakRealm}` ||
      !tokenPayload.sub ||
      !tokenPayload.email ||
      !tokenPayload.exp ||
      tokenPayload.exp <= Date.now() / 1000
    ) {
      // The token is invalid
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
      tokenPayload,
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
