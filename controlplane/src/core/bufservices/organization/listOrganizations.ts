import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ListOrganizationsRequest,
  ListOrganizationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function listOrganizations(
  opts: RouterOptions,
  _: ListOrganizationsRequest,
  ctx: HandlerContext,
) {
  let logger = getLogger(ctx, opts.logger);

  return handleError(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const membership = await orgRepo.memberships({ userId: authContext.userId });

    return {
      response: { code: EnumStatusCode.OK },
      organizations: membership.map((org) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        roles: org.rbac.roles,
      })),
    };
  });
}
