import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
    CheckOrganizationPermissionsRequest,
    CheckOrganizationPermissionsResponse
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function checkOrganizationPermissions(
  opts: RouterOptions,
  req: CheckOrganizationPermissionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CheckOrganizationPermissionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CheckOrganizationPermissionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (authContext.rbac.isOrganizationAdminOrDeveloper) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        hasOrganizationAdminOrDeveloperPermissions: true,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      hasOrganizationAdminOrDeveloperPermissions: false,
    };
  });
}
