import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AuditLog,
  GetAuditLogsRequest,
  GetAuditLogsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getAuditLogs(
  opts: RouterOptions,
  req: GetAuditLogsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAuditLogsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAuditLogsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const { dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      dateRange: {
        start: req.startDate,
        end: req.endDate,
      },
    });

    if (!dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        logs: [],
        count: 0,
      };
    }

    // check that the limit is less than the max option provided in the ui
    if (req.limit > 50) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid limit',
        },
        logs: [],
        count: 0,
      };
    }

    const auditLogs = await auditLogRepo.getAuditLogs({
      organizationId: authContext.organizationId,
      limit: req.limit,
      offset: req.offset,
      startDate: dateRange.start,
      endDate: dateRange.end,
    });
    const auditLogsCount = await auditLogRepo.getAuditLogsCount({
      organizationId: authContext.organizationId,
      startDate: dateRange.start,
      endDate: dateRange.end,
    });

    const logs: PlainMessage<AuditLog>[] = auditLogs.map((log) => ({
      actorDisplayName: log.actorDisplayName ?? '',
      actorType: log.actorType ?? '',
      apiKeyName: log.apiKeyName ?? '',
      auditAction: log.auditAction,
      createdAt: log.createdAt.toISOString(),
      auditableDisplayName: log.auditableDisplayName ?? '',
      targetType: log.targetType ?? '',
      action: log.action,
      targetDisplayName: log.targetDisplayName ?? '',
      id: log.id,
      targetNamespaceDisplayName: log.targetNamespaceDisplayName ?? '',
      targetNamespaceId: log.targetNamespaceId ?? '',
    }));

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      logs,
      count: auditLogsCount,
    };
  });
}
