import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetUserAccessiblePermissionsRequest,
  GetUserAccessiblePermissionsResponse,
  Permission,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { apiKeyPermissions } from '../../constants.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getUserAccessiblePermissions(
  opts: RouterOptions,
  req: GetUserAccessiblePermissionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetUserAccessiblePermissionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetUserAccessiblePermissionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const organizationRepository = new OrganizationRepository(logger, opts.db);

    if (!authContext.rbac.isOrganizationAdmin) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        permissions: [],
      };
    }

    const permissions: Permission[] = [];
    for (const permission of apiKeyPermissions) {
      if (permission.value === 'scim') {
        const feature = await organizationRepository.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'scim',
        });
        if (feature?.enabled) {
          permissions.push({
            displayName: permission.displayName,
            value: permission.value,
          } as Permission);
        }
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      permissions,
    };
  });
}
