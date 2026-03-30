import {
  RestartOnboardingRequest,
  RestartOnboardingResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { HandlerContext } from '@connectrpc/connect';
import { PlainMessage } from '@bufbuild/protobuf';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OnboardingRepository } from '../../repositories/OnboardingRepository.js';

export function restartOnboarding(
  opts: RouterOptions,
  req: RestartOnboardingRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RestartOnboardingResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RestartOnboardingResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const onboardingRepo = new OnboardingRepository(logger, opts.db);

    await onboardingRepo.deleteOnboarding({
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
