import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteAuditLogStreamConfigRequest,
  DeleteAuditLogStreamConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { AuditLogStreamRepository } from '../../repositories/AuditLogStreamRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';

export function deleteAuditLogStreamConfig(
  opts: RouterOptions,
  req: DeleteAuditLogStreamConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteAuditLogStreamConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteAuditLogStreamConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const deleted = await opts.db.transaction(async (tx) => {
      const config = await new AuditLogStreamRepository(tx).delete(authContext.organizationId);
      if (!config) {
        return;
      }

      await new AuditLogRepository(tx).addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'audit_log_stream_config.deleted',
        action: 'deleted',
        actorId: authContext.userId,
        auditableType: 'audit_log_stream_config',
        auditableDisplayName: config.endpoint,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });

      return config;
    });

    if (!deleted) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'No audit log stream is configured',
        },
      };
    }

    return {
      response: { code: EnumStatusCode.OK },
    };
  });
}
