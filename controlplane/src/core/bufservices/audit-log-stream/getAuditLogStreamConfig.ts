import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAuditLogStreamConfigRequest,
  GetAuditLogStreamConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogStreamRepository } from '../../repositories/AuditLogStreamRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';

export function getAuditLogStreamConfig(
  opts: RouterOptions,
  req: GetAuditLogStreamConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAuditLogStreamConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAuditLogStreamConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const config = await new AuditLogStreamRepository(opts.db).get(authContext.organizationId);

    return {
      response: { code: EnumStatusCode.OK },
      config: config
        ? {
            endpoint: config.endpoint,
            tokenSuffix: config.token.slice(-4),
            index: config.index ?? undefined,
            source: config.source ?? undefined,
            sourcetype: config.sourcetype,
            enabled: config.enabled,
            lastSuccessAt: config.lastSuccessAt?.toISOString(),
            lastError: config.lastError ?? undefined,
            lastErrorAt: config.lastErrorAt?.toISOString(),
          }
        : undefined,
    };
  });
}
