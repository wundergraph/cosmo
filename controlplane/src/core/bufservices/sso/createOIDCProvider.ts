import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOIDCProviderRequest,
  CreateOIDCProviderResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { uid } from 'uid';
import type { RouterOptions } from '../../routes.js';
import OidcProvider from '../../services/OidcProvider.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createOIDCProvider(
  opts: RouterOptions,
  req: CreateOIDCProviderRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOIDCProviderResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOIDCProviderResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const oidcProvider = new OidcProvider();
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    await opts.keycloakClient.authenticateClient();

    const alias = `${authContext.organizationSlug}_${uid(3)}`;

    await oidcProvider.createOidcProvider({
      kcClient: opts.keycloakClient,
      kcRealm: opts.keycloakRealm,
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      alias,
      db: opts.db,
      input: req,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      signInURL: `${opts.keycloakApiUrl}/realms/${opts.keycloakRealm}/broker/${alias}/endpoint`,
      signOutURL: `${opts.keycloakApiUrl}/realms/${opts.keycloakRealm}/broker/${alias}/endpoint/logout_response`,
      loginURL: `${opts.webBaseUrl}/login?sso=${alias}`,
    };
  });
}
