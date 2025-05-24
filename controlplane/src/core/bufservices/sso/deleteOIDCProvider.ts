import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteOIDCProviderRequest,
  DeleteOIDCProviderResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import OidcProvider from '../../services/OidcProvider.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteOIDCProvider(
  opts: RouterOptions,
  req: DeleteOIDCProviderRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOIDCProviderResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOIDCProviderResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const oidcRepo = new OidcRepository(opts.db);
    const oidcProvider = new OidcProvider();

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    await opts.keycloakClient.authenticateClient();

    const organization = await orgRepo.byId(authContext.organizationId);
    if (!organization) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
    if (!provider) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization ${authContext.organizationSlug} doesn't have an oidc identity provider `,
        },
      };
    }

    await oidcProvider.deleteOidcProvider({
      kcClient: opts.keycloakClient,
      kcRealm: opts.keycloakRealm,
      organizationSlug: authContext.organizationSlug,
      orgCreatorUserId: organization.creatorUserId,
      alias: provider.alias,
    });

    await oidcRepo.deleteOidcProvider({ organizationId: authContext.organizationId });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
