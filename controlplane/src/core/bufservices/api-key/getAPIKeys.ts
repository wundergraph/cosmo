import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetAPIKeysRequest, GetAPIKeysResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ApiKeyRepository } from '../../repositories/ApiKeyRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

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

    const apiKeys = await apiKeyRepo.getAPIKeys({ organizationID: authContext.organizationId });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      apiKeys,
    };
  });
}
