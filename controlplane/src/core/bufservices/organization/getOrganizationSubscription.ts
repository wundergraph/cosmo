import {
  GetOrganizationSubscriptionRequest,
  GetOrganizationSubscriptionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { HandlerContext } from '@connectrpc/connect';
import { PlainMessage } from '@bufbuild/protobuf';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { BillingRepository } from '../../repositories/BillingRepository.js';

export function getOrganizationSubscription(
  opts: RouterOptions,
  req: GetOrganizationSubscriptionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationSubscriptionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationSubscriptionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const billingRepo = new BillingRepository(opts.db);

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
        isActive: false,
      };
    }

    const subscription = await billingRepo.getActiveSubscriptionOfOrganization(org.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      isActive: Boolean(subscription?.id),
    };
  });
}
