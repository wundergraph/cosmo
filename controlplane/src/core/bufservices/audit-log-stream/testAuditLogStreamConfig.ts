import { randomUUID } from 'node:crypto';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  TestAuditLogStreamConfigRequest,
  TestAuditLogStreamConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { destinationDisplayName, sendAuditLogs } from '../../audit-log-stream/deliver.js';
import { AuditLogStreamRepository, isAuditLogStreamingEnabled } from '../../repositories/AuditLogStreamRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';

export function testAuditLogStreamConfig(
  opts: RouterOptions,
  req: TestAuditLogStreamConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<TestAuditLogStreamConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<TestAuditLogStreamConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    if (!(await isAuditLogStreamingEnabled(orgRepo, authContext.organizationId))) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: 'Audit log streaming is not enabled for this organization',
        },
      };
    }

    const repo = new AuditLogStreamRepository(opts.db);
    const config = await repo.get(authContext.organizationId);
    if (!config) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'No audit log stream is configured',
        },
      };
    }

    // The test event has the same shape as a real one, so it exercises the user's field extractions too.
    const error = await sendAuditLogs(config, [
      {
        id: randomUUID(),
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        action: 'tested',
        auditAction: 'audit_log_stream_config.tested',
        auditableType: 'audit_log_stream_config',
        auditableDisplayName: destinationDisplayName(config.destination),
        targetId: null,
        targetType: null,
        targetDisplayName: null,
        targetNamespaceId: null,
        targetNamespaceDisplayName: null,
        actorId: authContext.userId || null,
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        apiKeyName: authContext.apiKeyName ?? null,
        createdAt: new Date(),
      },
    ]);
    if (error) {
      await repo.recordError(authContext.organizationId, error);
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: error,
        },
      };
    }

    await repo.recordSuccess(authContext.organizationId);

    return {
      response: { code: EnumStatusCode.OK },
    };
  });
}
