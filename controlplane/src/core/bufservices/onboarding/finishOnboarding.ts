import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  FinishOnboardingRequest,
  FinishOnboardingResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function finishOnboarding(
  opts: RouterOptions,
  req: FinishOnboardingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<FinishOnboardingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<FinishOnboardingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const onboardingRepo = new OnboardingRepository(opts.db, authContext.organizationId);
    const onboarding = await onboardingRepo.finish(authContext.userId);

    if (!onboarding) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Onboarding not found',
        },
        federatedGraphsCount: 0,
        finishedAt: '',
      };
    }

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraphsCount = await fedGraphRepo.count();

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      federatedGraphsCount,
      finishedAt: onboarding.finishedAt!.toISOString(),
    };
  });
}
