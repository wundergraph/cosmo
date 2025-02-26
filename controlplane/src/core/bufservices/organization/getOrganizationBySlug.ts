import { HandlerContext } from '@connectrpc/connect';
import { PlainMessage } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationBySlugRequest,
  GetOrganizationBySlugResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';

export function getOrganizationBySlug(
  opts: RouterOptions,
  req: GetOrganizationBySlugRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationBySlugResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationBySlugResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const organization = await orgRepo.bySlug(req.slug);
    if (!organization) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      organization,
    };
  });
}
