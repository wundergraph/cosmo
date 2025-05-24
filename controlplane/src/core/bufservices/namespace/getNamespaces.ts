import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetNamespacesRequest, GetNamespacesResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getNamespaces(
  opts: RouterOptions,
  req: GetNamespacesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetNamespacesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetNamespacesResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespaces = await namespaceRepo.list(authContext.rbac);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      namespaces,
    };
  });
}
