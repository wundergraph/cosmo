import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationWebhookMetaRequest,
  GetOrganizationWebhookMetaResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getOrganizationWebhookMeta(
  opts: RouterOptions,
  req: GetOrganizationWebhookMetaRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationWebhookMetaResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationWebhookMetaResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const eventsMeta = await orgRepo.getWebhookMeta(req.id, authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      eventsMeta,
    };
  });
}
