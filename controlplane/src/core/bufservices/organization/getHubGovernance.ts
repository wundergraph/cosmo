import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetHubGovernanceRequest,
  GetHubGovernanceResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { GraphResourceOwnerRepository } from '../../repositories/GraphResourceOwnerRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { PlainMessage } from '../../../types/index.js';

export function getHubGovernance(
  opts: RouterOptions,
  req: GetHubGovernanceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetHubGovernanceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetHubGovernanceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const ownerRepo = new GraphResourceOwnerRepository(opts.db, authContext.organizationId);

    const members = await orgRepo.getMembers({ organizationID: authContext.organizationId, limit: 10_000 });
    const groups = await orgGroupRepo.forOrganization(authContext.organizationId);
    const explicitOwners = await ownerRepo.explicitOwnersForOrganization();
    const derivedSubgraphOwners = await ownerRepo.subgraphOwnersFromGroupRules();

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      organization: {
        id: authContext.organizationId,
        slug: authContext.organizationSlug,
      },
      members: members.map((member) => ({
        orgMemberId: member.orgMemberID,
        userId: member.userID,
        email: member.email,
        groupIds: member.rbac.groups.map((group) => group.groupId),
      })),
      groups: groups.map((group) => ({
        groupId: group.groupId,
        name: group.name,
        description: group.description,
        builtin: group.builtin,
        rules: group.rules,
        hubPermissions: group.hubPermissions,
      })),
      owners: [...explicitOwners, ...derivedSubgraphOwners],
    };
  });
}
