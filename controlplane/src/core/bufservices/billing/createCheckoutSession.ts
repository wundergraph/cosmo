import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { BillingService } from '../../services/BillingService.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createCheckoutSession(
  opts: RouterOptions,
  req: CreateCheckoutSessionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateCheckoutSessionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateCheckoutSessionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const billingRepo = new BillingRepository(opts.db);
    const billingService = new BillingService(opts.db, billingRepo);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    if (!opts.stripeSecretKey) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Billing is not enabled. Please contact support.',
        },
        sessionId: '',
      };
    }

    const session = await billingService.createCheckoutSession({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      plan: req.plan,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sessionId: session.id,
    };
  });
}
