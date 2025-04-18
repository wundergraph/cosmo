import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationRuleSetsRequest,
  GetOrganizationRuleSetsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRuleSetRepository } from "../../repositories/OrganizationRuleSetRepository.js";

export function getOrganizationRuleSets(
  opts: RouterOptions,
  req: GetOrganizationRuleSetsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationRuleSetsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationRuleSetsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const ruleSetRepo = new OrganizationRuleSetRepository(opts.db);
    const ruleSets = await ruleSetRepo.listForOrganization(authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      ruleSets: ruleSets.map(({ id, kcGroupId, ...rs }) => ({
        ruleSetId: id,
        ...rs,
      })),
      totalCount: ruleSets.length,
    };
  });
}