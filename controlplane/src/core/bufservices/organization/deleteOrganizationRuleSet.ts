import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteOrganizationRuleSetRequest,
  DeleteOrganizationRuleSetResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRuleSetRepository } from '../../repositories/OrganizationRuleSetRepository.js';

export function deleteOrganizationRuleSet(
  opts: RouterOptions,
  req: DeleteOrganizationRuleSetRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOrganizationRuleSetResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOrganizationRuleSetResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return opts.db.transaction(async (tx) => {
      const ruleSetRepo = new OrganizationRuleSetRepository(tx);

      const ruleSet = await ruleSetRepo.byId(req.ruleSetId);
      if (!ruleSet) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
        };
      }

      if (ruleSet.builtin) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Builtin rule sets cannot be deleted',
          },
        };
      }

      if (ruleSet.membersCount > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Move all rule set members before trying to delete the rule set',
          },
        };
      }

      await ruleSetRepo.deleteRuleSet(ruleSet.id);

      if (ruleSet.kcGroupId) {
        await opts.keycloakClient.authenticateClient();
        await opts.keycloakClient.client.groups.del({
          realm: opts.keycloakRealm,
          id: ruleSet.kcGroupId,
        });
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
