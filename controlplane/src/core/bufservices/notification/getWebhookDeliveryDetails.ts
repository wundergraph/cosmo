import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetWebhookDeliveryDetailsRequest,
  GetWebhookDeliveryDetailsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getWebhookDeliveryDetails(
  opts: RouterOptions,
  req: GetWebhookDeliveryDetailsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetWebhookDeliveryDetailsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetWebhookDeliveryDetailsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const delivery = await orgRepo.getWebhookDeliveryById(req.id, authContext.organizationId);
    if (!delivery) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find webhook delivery`,
        },
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      delivery: {
        ...delivery,
        createdBy: delivery.user?.email || undefined,
        isRedelivery: !!delivery.originalDeliveryId,
        createdAt: delivery.createdAt.toISOString(),
        requestHeaders: JSON.stringify(delivery.requestHeaders),
        responseHeaders: delivery.responseHeaders ? JSON.stringify(delivery.responseHeaders) : undefined,
        responseStatusCode: delivery.responseStatusCode || undefined,
        responseErrorCode: delivery.responseErrorCode || undefined,
        responseBody: delivery.responseBody || undefined,
        errorMessage: delivery.errorMessage || undefined,
      },
    };
  });
}
