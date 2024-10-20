import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  EnableLintingForTheNamespaceRequest,
  EnableLintingForTheNamespaceResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function enableLintingForTheNamespace(
  opts: RouterOptions,
  req: EnableLintingForTheNamespaceRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<EnableLintingForTheNamespaceResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<EnableLintingForTheNamespaceResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
      };
    }

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
      };
    }

    await namespaceRepo.toggleEnableLinting({ name: req.namespace, enableLinting: req.enableLinting });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
