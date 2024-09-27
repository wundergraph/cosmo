import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOIDCProviderRequest,
  GetOIDCProviderResponse,
  UpdateIDPMappersRequest,
  UpdateIDPMappersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import OidcProvider from '../../services/OidcProvider.js';

export function updateIDPMappers(
  opts: RouterOptions,
  req: UpdateIDPMappersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateIDPMappersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateIDPMappersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.isAdmin) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
      };
    }

    const oidcProvider = new OidcProvider();
    const oidcRepo = new OidcRepository(opts.db);

    await opts.keycloakClient.authenticateClient();

    const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
    if (!provider) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `OIDC Provider not found`,
        },
      };
    }

    await oidcProvider.deleteIDPMappers({
      alias: provider.alias,
      kcClient: opts.keycloakClient,
      kcRealm: opts.keycloakRealm,
    });

    await oidcProvider.addIDPMappers({
      kcClient: opts.keycloakClient,
      kcRealm: opts.keycloakRealm,
      mappers: req.mappers,
      organizationSlug: authContext.organizationSlug,
      endpoint: provider.endpoint,
      alias: provider.alias,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
