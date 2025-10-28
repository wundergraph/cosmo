import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  VerifyAPIKeyGraphAccessRequest,
  VerifyAPIKeyGraphAccessResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';

export function verifyAPIKeyGraphAccess(
  opts: RouterOptions,
  req: VerifyAPIKeyGraphAccessRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<VerifyAPIKeyGraphAccessResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<VerifyAPIKeyGraphAccessResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byId(req.federatedGraphId);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        hasOrganizationAdminOrDeveloperPermissions: false,
        hasWriteAccessToGraph: false,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      hasOrganizationAdminOrDeveloperPermissions: authContext.rbac.isOrganizationAdminOrDeveloper,
      hasWriteAccessToGraph: authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph),
    };
  });
}
