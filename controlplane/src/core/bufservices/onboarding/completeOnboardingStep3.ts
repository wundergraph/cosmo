import {
  CompleteOnboardingStep3Request,
  CompleteOnboardingStep3Response,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { HandlerContext } from '@connectrpc/connect';
import { PlainMessage } from '@bufbuild/protobuf';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';
import { serializeOnboardingDTO } from './utils.js';

export function completeOnboardingStep3(
  opts: RouterOptions,
  req: CompleteOnboardingStep3Request,
  ctx: HandlerContext,
): Promise<PlainMessage<CompleteOnboardingStep3Response>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CompleteOnboardingStep3Response>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const onboardingRepo = new OnboardingRepository(logger, opts.db);

    const onboarding = await onboardingRepo.completeStep3({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      federatedGraphId: req.federatedGraphId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      onboarding: onboarding ? serializeOnboardingDTO(onboarding) : undefined,
    };
  });
}
