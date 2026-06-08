import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetOnboardingRequest, GetOnboardingResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getOnboarding(
  opts: RouterOptions,
  req: GetOnboardingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOnboardingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOnboardingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const [org, federatedGraphsCount] = await Promise.all([
      orgRepo.byId(authContext.organizationId),
      fedGraphRepo.count(),
    ]);

    if (!org || org.creatorUserId !== authContext.userId) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        federatedGraphsCount,
        enabled: false,
      };
    }

    const onboardingRepo = new OnboardingRepository(opts.db, authContext.organizationId);
    const onboarding = await onboardingRepo.getByUserId(authContext.userId);

    if (!onboarding) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        federatedGraphsCount,
        enabled: true,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      finishedAt: onboarding.finishedAt?.toISOString(),
      federatedGraphsCount,
      enabled: true,
    };
  });
}
