import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOIDCProviderRequest,
  GetOIDCProviderResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getOIDCProvider(
  opts: RouterOptions,
  req: GetOIDCProviderRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOIDCProviderResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOIDCProviderResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const oidcRepo = new OidcRepository(opts.db);

    await opts.keycloakClient.authenticateClient();

    const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
    if (!provider) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
        name: '',
        endpoint: '',
        loginURL: '',
        signInRedirectURL: '',
        signOutRedirectURL: '',
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      name: provider.name,
      endpoint: provider.endpoint,
      loginURL: `${opts.webBaseUrl}/login?sso=${provider.alias}`,
      signInRedirectURL: new URL(
        `/realms/${opts.keycloakRealm}/broker/${provider.alias}/endpoint`,
        opts.keycloakApiUrl,
      ).toString(),
      signOutRedirectURL: new URL(
        `/realms/${opts.keycloakRealm}/broker/${provider.alias}/endpoint/logout_response`,
        opts.keycloakApiUrl,
      ).toString(),
    };
  });
}
