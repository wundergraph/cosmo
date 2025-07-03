import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationGroupsRequest,
  GetOrganizationGroupsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import OidcProvider from '../../services/OidcProvider.js';

export function getOrganizationGroups(
  opts: RouterOptions,
  req: GetOrganizationGroupsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationGroupsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationGroupsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const oidcRepo = new OidcRepository(opts.db);
    const oidcProvider = new OidcProvider();

    const groups = await orgGroupRepo.forOrganization(authContext.organizationId);

    let oidcMappers: { groupId: string }[] = [];
    const oidc = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
    if (oidc) {
      // Retrieve all the OIDC mappers from Keycloak
      await opts.keycloakClient.authenticateClient();
      oidcMappers = await oidcProvider.fetchIDPMappers({
        kcClient: opts.keycloakClient,
        kcRealm: opts.keycloakRealm,
        alias: oidc.alias,
        organizationId: authContext.organizationId,
        db: opts.db,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      hasConnectedOidc: !!oidc,
      groups: groups.map(({ kcGroupId, ...rest }) => ({
        ...rest,
        hasOidcMappers: oidcMappers.some((mapper) => mapper.groupId === rest.groupId),
      })),
    };
  });
}
