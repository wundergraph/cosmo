import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { WhoAmIRequest, WhoAmIResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function whoAmI(
  opts: RouterOptions,
  req: WhoAmIRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<WhoAmIResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<WhoAmIResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const organization = await orgRepo.byId(authContext.organizationId);

    if (!organization) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
        organizationName: '',
        organizationSlug: '',
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      organizationName: organization.name,
      organizationSlug: organization.slug,
    };
  });
}
