import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetWorkspaceRequest, GetWorkspaceResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { WorkspaceService } from '../../services/WorkspaceService.js';

export function getWorkspace(
  opts: RouterOptions,
  _: GetWorkspaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetWorkspaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetWorkspaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const workspaceService = new WorkspaceService(authContext.organizationId, authContext.rbac, opts.db);
    const namespaces = await workspaceService.getWorkspaceNamespaces();

    return {
      response: { code: EnumStatusCode.OK },
      namespaces,
    };
  });
}
