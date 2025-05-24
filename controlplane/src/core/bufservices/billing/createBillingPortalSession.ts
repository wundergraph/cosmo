import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateBillingPortalSessionRequest,
  CreateBillingPortalSessionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { BillingRepository } from '../../repositories/BillingRepository.js';
import type { RouterOptions } from '../../routes.js';
import { BillingService } from '../../services/BillingService.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createBillingPortalSession(
  opts: RouterOptions,
  req: CreateBillingPortalSessionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateBillingPortalSessionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateBillingPortalSessionResponse>>(ctx, logger, async () => {
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
        url: '',
      };
    }

    const session = await billingService.createBillingPortalSession({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sessionId: session.id,
      url: session.url,
    };
  });
}
