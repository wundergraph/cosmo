import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreatePlaygroundScriptRequest,
  CreatePlaygroundScriptResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlaygroundScriptsRepository } from '../../repositories/PlaygroundScriptsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function createPlaygroundScript(
  opts: RouterOptions,
  req: CreatePlaygroundScriptRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreatePlaygroundScriptResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreatePlaygroundScriptResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new PlaygroundScriptsRepository(opts.db, authContext.organizationId);
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    await repo.create({
      title: req.title,
      content: req.content,
      type: req.type,
      createdBy: authContext.userId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
