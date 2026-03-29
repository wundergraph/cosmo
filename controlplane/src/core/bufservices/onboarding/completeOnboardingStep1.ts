import {
  CompleteOnboardingStep1Request,
  CompleteOnboardingStep1Response,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { HandlerContext } from '@connectrpc/connect';
import { PlainMessage } from '@bufbuild/protobuf';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';
import { serializeOnboardingDTO } from './utils.js';

export function completeOnboardingStep1(
  opts: RouterOptions,
  req: CompleteOnboardingStep1Request,
  ctx: HandlerContext,
): Promise<PlainMessage<CompleteOnboardingStep1Response>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CompleteOnboardingStep1Response>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const onboardingRepo = new OnboardingRepository(logger, opts.db);

    const onboarding = await onboardingRepo.createOnboarding({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      slack: req.slack,
      email: req.email,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      onboarding: onboarding ? serializeOnboardingDTO(onboarding) : undefined,
    };
  });
}
