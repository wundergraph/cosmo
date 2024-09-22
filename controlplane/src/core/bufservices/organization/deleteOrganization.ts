import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
    DeleteOrganizationRequest,
    DeleteOrganizationResponse
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import OidcProvider from '../../services/OidcProvider.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteOrganization(
  opts: RouterOptions,
  req: DeleteOrganizationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOrganizationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOrganizationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const billingRepo = new BillingRepository(opts.db);
    const oidcRepo = new OidcRepository(opts.db);
    const oidcProvider = new OidcProvider();

    const memberships = await orgRepo.memberships({ userId: authContext.userId });
    const orgCount = memberships.length;

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const user = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
    });

    if (!user) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    // non admins cannot delete the organization
    if (!user.roles.includes('admin')) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User does not have the permissions to delete the organization.',
        },
      };
    }

    // Minimum one organization is required for a user
    if (orgCount <= 1) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Minimum one organization is required for a user.',
        },
      };
    }

    await opts.keycloakClient.authenticateClient();

    await billingRepo.cancelSubscription(authContext.organizationId);

    const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
    if (provider) {
      await oidcProvider.deleteOidcProvider({
        kcClient: opts.keycloakClient,
        kcRealm: opts.keycloakRealm,
        organizationSlug: org.slug,
        alias: provider.alias,
      });
    }

    await orgRepo.deleteOrganization(authContext.organizationId);

    await opts.keycloakClient.deleteOrganizationGroup({
      realm: opts.keycloakRealm,
      organizationSlug: org.slug,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
