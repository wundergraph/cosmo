import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationWebhookConfigsRequest,
  GetOrganizationWebhookConfigsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getOrganizationWebhookConfigs(
  opts: RouterOptions,
  req: GetOrganizationWebhookConfigsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationWebhookConfigsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationWebhookConfigsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const configs = await orgRepo.getWebhookConfigs(authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      configs,
    };
  });
}
