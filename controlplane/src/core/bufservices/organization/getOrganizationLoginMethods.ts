import { PlainMessage } from '../../../types/index.js';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationLoginMethodsRequest,
  GetOrganizationLoginMethodsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationLoginMethodRepository } from '../../repositories/OrganizationLoginMethodRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getOrganizationLoginMethods(
  opts: RouterOptions,
  _req: GetOrganizationLoginMethodsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationLoginMethodsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationLoginMethodsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db);
    const feature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'login-method-restrictions',
    });
    if (!feature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: 'Login method restrictions are available on the Enterprise plan.',
        },
      };
    }

    const repo = new OrganizationLoginMethodRepository(opts.db);
    const methods = await repo.getAllowedLoginMethods({ organizationId: authContext.organizationId });

    return {
      response: { code: EnumStatusCode.OK },
      loginMethods: { ...methods },
    };
  });
}
