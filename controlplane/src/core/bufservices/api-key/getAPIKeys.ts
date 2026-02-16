import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetAPIKeysRequest, GetAPIKeysResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import type { RouterOptions } from '../../routes.js';
import { clamp, enrichLogger, getLogger, handleError } from '../../util.js';

export function getAPIKeys(
  opts: RouterOptions,
  req: GetAPIKeysRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAPIKeysResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAPIKeysResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const apiKeyRepo = new ApiKeyRepository(opts.db);

    // default to 10 if no limit is provided
    req.limit = clamp(req.limit || 10, 1, 50);
    // the max no of api keys is 200, but set the max to 1000 to be safe
    req.offset = clamp(req.offset || 0, 0, 1000);

    const apiKeys = await apiKeyRepo.getAPIKeys({
      organizationID: authContext.organizationId,
      limit: req.limit,
      offset: req.offset,
    });

    const count = await apiKeyRepo.getAPIKeysCount({
      organizationID: authContext.organizationId,
      includeExternal: true,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      apiKeys,
      count,
    };
  });
}
