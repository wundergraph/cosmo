import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpsertAuditLogStreamConfigRequest,
  UpsertAuditLogStreamConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { DEFAULT_SOURCE, DEFAULT_SOURCETYPE, normalizeHecEndpoint } from '../../audit-log-stream/splunk-hec.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { AuditLogStreamRepository } from '../../repositories/AuditLogStreamRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';

export function upsertAuditLogStreamConfig(
  opts: RouterOptions,
  req: UpsertAuditLogStreamConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpsertAuditLogStreamConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpsertAuditLogStreamConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const endpoint = normalizeHecEndpoint(req.endpoint);
    if (!endpoint) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'The endpoint must be a valid HTTPS URL',
        },
      };
    }

    const repo = new AuditLogStreamRepository(opts.db);
    const existing = await repo.get(authContext.organizationId);
    const token = req.token?.trim() || undefined;

    if (!existing && !token) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'A HEC token is required',
        },
      };
    }

    const saved = await opts.db.transaction(async (tx) => {
      const saved = await new AuditLogStreamRepository(tx).upsert({
        organizationId: authContext.organizationId,
        endpoint,
        token,
        index: req.index?.trim() || null,
        source: req.source?.trim() || DEFAULT_SOURCE,
        sourcetype: req.sourcetype?.trim() || DEFAULT_SOURCETYPE,
        enabled: req.enabled,
      });
      if (!saved) {
        return false;
      }

      await new AuditLogRepository(tx).addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: existing ? 'audit_log_stream_config.updated' : 'audit_log_stream_config.created',
        action: existing ? 'updated' : 'created',
        actorId: authContext.userId,
        auditableType: 'audit_log_stream_config',
        auditableDisplayName: endpoint,
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });
      return true;
    });

    // The config was deleted after it was read, and there's no token to recreate it with.
    if (!saved) {
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
