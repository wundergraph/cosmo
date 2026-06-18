import { PlainMessage } from '../../../types/index.js';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ListOIDCProvidersRequest,
  ListOIDCProvidersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, mergeUrls } from '../../util.js';

export function listOIDCProviders(
  opts: RouterOptions,
  _req: ListOIDCProvidersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ListOIDCProvidersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ListOIDCProvidersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const oidcRepo = new OidcRepository(opts.db);
    const providers = await oidcRepo.listOidcProvidersByOrganizationId({
      organizationId: authContext.organizationId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        alias: p.alias,
        endpoint: p.endpoint,
        loginUrl: `${opts.webBaseUrl}/login?sso=${p.alias}`,
        signInRedirectUrl: mergeUrls(opts.keycloakApiUrl, `realms/${opts.keycloakRealm}/broker/${p.alias}/endpoint`),
        signOutRedirectUrl: mergeUrls(
          opts.keycloakApiUrl,
          `realms/${opts.keycloakRealm}/broker/${p.alias}/endpoint/logout_response`,
        ),
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });
}
