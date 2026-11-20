import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetHubAiSettingsRequest,
  GetHubAiSettingsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { HubAiSettingsRepository } from '../../repositories/HubAiSettingsRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { PlainMessage } from '../../../types/index.js';

export function getHubAiSettings(
  opts: RouterOptions,
  req: GetHubAiSettingsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetHubAiSettingsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetHubAiSettingsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const settings = await new HubAiSettingsRepository(opts.db).byOrganization(authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      settings,
    };
  });
}
