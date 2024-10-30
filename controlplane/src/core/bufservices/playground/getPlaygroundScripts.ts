import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetPlaygroundScriptsRequest,
  GetPlaygroundScriptsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlaygroundScriptsRepository } from '../../repositories/PlaygroundScriptsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getPlaygroundScripts(
  opts: RouterOptions,
  req: GetPlaygroundScriptsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetPlaygroundScriptsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetPlaygroundScriptsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new PlaygroundScriptsRepository(opts.db, authContext.organizationId);

    const scripts = await repo.list(req.type);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      scripts,
    };
  });
}
