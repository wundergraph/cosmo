import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOrganizationMemberGroupRequest,
  CreateOrganizationMemberGroupResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationMemberGroupRepository } from '../../repositories/OrganizationMemberGroupRepository.js';
import { OrganizationMemberGroupDTO } from '../../../types/index.js';

export function createOrganizationMemberGroup(
  opts: RouterOptions,
  req: CreateOrganizationMemberGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOrganizationMemberGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOrganizationMemberGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const ruleSetRepo = new OrganizationMemberGroupRepository(opts.db);
    if (await ruleSetRepo.exists({ organizationId: authContext.organizationId, ruleSetName: req.name })) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `A group with the name "${req.name}" already exists.`,
        },
      };
    }

    await opts.keycloakClient.authenticateClient();
    const createdGroupId = await opts.keycloakClient.createSubGroup({
      realm: opts.keycloakRealm,
      organizationSlug: authContext.organizationSlug,
      groupName: req.name,
    });

    if (!createdGroupId) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Could not create the new group',
        },
      };
    }

    let createdRuleSet: OrganizationMemberGroupDTO;
    try {
      createdRuleSet = await ruleSetRepo.createRuleSet({
        organizationId: authContext.organizationId,
        name: req.name,
        kcGroupId: createdGroupId,
      });
    } catch (e: unknown) {
      await opts.keycloakClient.client.groups.del({ id: createdGroupId });
      throw e;
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      groups: {
        groupId: createdRuleSet.id,
        name: createdRuleSet.name,
        membersCount: 0,
        rules: [],
      },
    };
  });
}
