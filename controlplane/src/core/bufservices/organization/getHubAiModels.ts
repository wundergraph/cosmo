import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetHubAiModelsRequest, GetHubAiModelsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { fetchHubAiModels } from '../../hub/hubAiModels.js';
import type { PlainMessage } from '../../../types/index.js';

export function getHubAiModels(
  opts: RouterOptions,
  req: GetHubAiModelsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetHubAiModelsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetHubAiModelsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (!opts.hubApiUrl) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'This control plane is not connected to Hub (HUB_API_URL is not set)',
        },
        models: [],
        deploymentModel: '',
      };
    }

    const { models, deploymentModel } = await fetchHubAiModels(opts.hubApiUrl);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      models,
      deploymentModel,
    };
  });
}
