import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOrganizationRuleSetRequest,
  CreateOrganizationRuleSetResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRuleSetRepository } from '../../repositories/OrganizationRuleSetRepository.js';
import { OrganizationRuleSetDTO } from '../../../types/index.js';

export function createOrganizationRuleSet(
  opts: RouterOptions,
  req: CreateOrganizationRuleSetRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOrganizationRuleSetResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOrganizationRuleSetResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const ruleSetRepo = new OrganizationRuleSetRepository(opts.db);
    if (await ruleSetRepo.exists({ organizationId: authContext.organizationId, ruleSetName: req.name })) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `A rule set with the name "${req.name}" already exists.`,
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
          details: 'Could not create new rule set',
        },
      };
    }

    let createdRuleSet: OrganizationRuleSetDTO;
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
      ruleSet: {
        ruleSetId: createdRuleSet.id,
        name: createdRuleSet.name,
        membersCount: 0,
        rules: [],
      },
    };
  });
}
