import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateOnboardingRequest,
  CreateOnboardingResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createOnboarding(
  opts: RouterOptions,
  req: CreateOnboardingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateOnboardingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateOnboardingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const org = await orgRepo.byId(authContext.organizationId);

    if (!org || org.creatorUserId !== authContext.userId) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Only the organization creator can create onboarding.',
        },
        federatedGraphsCount: 0,
        slack: false,
        email: false,
      };
    }

    const onboardingRepo = new OnboardingRepository(opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    const [onboarding, federatedGraphsCount] = await Promise.all([
      onboardingRepo.createOrUpdate({
        userId: authContext.userId,
        slack: req.slack,
        email: req.email,
      }),
      fedGraphRepo.count(),
    ]);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      finishedAt: onboarding.finishedAt?.toISOString(),
      federatedGraphsCount,
      slack: onboarding.slack,
      email: onboarding.email,
    };
  });
}
