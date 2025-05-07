import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrgMemberRoleRequest,
  UpdateOrgMemberRoleResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function updateOrgMemberRole(
  opts: RouterOptions,
  req: UpdateOrgMemberRoleRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrgMemberRoleResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrgMemberRoleResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return {
      response: {
        code: EnumStatusCode.ERR,
        detail: 'Endpoint deprecated',
      },
    };
  });
}
