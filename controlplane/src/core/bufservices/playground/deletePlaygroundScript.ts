import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeletePlaygroundScriptRequest,
  DeletePlaygroundScriptResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlaygroundScriptsRepository } from '../../repositories/PlaygroundScriptsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deletePlaygroundScript(
  opts: RouterOptions,
  req: DeletePlaygroundScriptRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeletePlaygroundScriptResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeletePlaygroundScriptResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new PlaygroundScriptsRepository(opts.db, authContext.organizationId);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesn't have the permissions to perform this operation`,
        },
        compositionErrors: [],
        deploymentErrors: [],
      };
    }

    await repo.delete(req.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
