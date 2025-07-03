import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOIDCProviderRequest,
  GetOIDCProviderResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, mergeUrls } from '../../util.js';
import OidcProvider from '../../services/OidcProvider.js';

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
    const oidcProvider = new OidcProvider();

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
        mappers: [],
      };
    }
    const mappers = await oidcProvider.fetchIDPMappers({
      alias: provider.alias,
      kcRealm: opts.keycloakRealm,
      kcClient: opts.keycloakClient,
      organizationId: authContext.organizationId,
      db: opts.db,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      name: provider.name,
      endpoint: provider.endpoint,
      loginURL: `${opts.webBaseUrl}/login?sso=${provider.alias}`,
      signInRedirectURL: mergeUrls(
        opts.keycloakApiUrl,
        `realms/${opts.keycloakRealm}/broker/${provider.alias}/endpoint`,
      ),
      signOutRedirectURL: mergeUrls(
        opts.keycloakApiUrl,
        `realms/${opts.keycloakRealm}/broker/${provider.alias}/endpoint/logout_response`,
      ),
      mappers,
    };
  });
}
