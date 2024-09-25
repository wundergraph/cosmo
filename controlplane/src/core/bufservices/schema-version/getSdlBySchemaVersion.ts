import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSdlBySchemaVersionRequest,
  GetSdlBySchemaVersionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getSdlBySchemaVersion(
  opts: RouterOptions,
  req: GetSdlBySchemaVersionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSdlBySchemaVersionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSdlBySchemaVersionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    const schema = await fedRepo.getSdlBasedOnSchemaVersion({
      targetId: req.targetId,
      schemaVersionId: req.schemaVersionId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sdl: schema?.sdl || '',
      clientSchema: schema?.clientSchema || '',
    };
  });
}
