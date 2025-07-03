import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RedeliverWebhookRequest,
  RedeliverWebhookResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { RedeliverWebhookService } from '../../webhooks/RedeliverWebhookService.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function redeliverWebhook(
  opts: RouterOptions,
  req: RedeliverWebhookRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RedeliverWebhookResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RedeliverWebhookResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const redeliverWebhookService = new RedeliverWebhookService(opts.db, authContext.organizationId, logger);

    const originalDelivery = await orgRepo.getWebhookDeliveryById(req.id, authContext.organizationId);
    if (!originalDelivery) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find webhook delivery`,
        },
      };
    }

    await redeliverWebhookService.send(originalDelivery, authContext.userId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
