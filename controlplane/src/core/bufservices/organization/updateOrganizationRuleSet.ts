import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrganizationRuleSetRequest,
  UpdateOrganizationRuleSetResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { memberRoleEnum } from '../../../db/schema.js';
import { OrganizationRuleSetRepository } from '../../repositories/OrganizationRuleSetRepository.js';
import { MemberRole } from '../../../db/models.js';

export function updateOrganizationRuleSet(
  opts: RouterOptions,
  req: UpdateOrganizationRuleSetRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrganizationRuleSetResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrganizationRuleSetResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const ruleSetRepo = new OrganizationRuleSetRepository(opts.db);
    if (!(await ruleSetRepo.exists({ organizationId: authContext.organizationId, ruleSetId: req.ruleSetId }))) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    // Combine resources into a single array of unique values per role
    const allResourcesGroupedByRole = Object.groupBy(req.rules, ({ role }) => role);
    const resourcesByRole: { role: MemberRole; resources: string[] }[] = [];
    for (const key of Object.keys(allResourcesGroupedByRole)) {
      const role = memberRoleEnum.enumValues.find((r) => r === key.toLowerCase());
      const groupRules = allResourcesGroupedByRole[key];
      if (!role || !groupRules?.length) {
        // Skip this iteration if the role is unknown or there are no rules associated with the role
        continue;
      }

      const groupResources = groupRules.flatMap((x) => x.resources);
      resourcesByRole.push({
        role,
        resources: [...new Set(groupResources.map((res) => res.toLowerCase()))],
      });
    }

    await ruleSetRepo.updateRules({ ruleSetId: req.ruleSetId, rules: resourcesByRole });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
