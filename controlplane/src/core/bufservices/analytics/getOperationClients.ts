import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationClientsRequest,
  GetOperationClientsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { isoDateRangeToTimestamps, getDateRange } from '../../repositories/analytics/util.js';

export function getOperationClients(
  opts: RouterOptions,
  req: GetOperationClientsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOperationClientsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationClientsResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        clients: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        clients: [],
      };
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    // Use provided range/dateRange or fall back to default
    const inputRange = req.range ?? (req.dateRange ? undefined : 24);
    const { range, dateRange: validatedDateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      range: inputRange,
      dateRange: req.dateRange,
    });

    if (!range && !validatedDateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        clients: [],
      };
    }

    const parsedDateRange = isoDateRangeToTimestamps(validatedDateRange, range || 24);
    const [startTimestamp, endTimestamp] = getDateRange(parsedDateRange);

    const operationNameFilter = req.operationName === undefined ? '' : `AND OperationName = '${req.operationName.replace(/'/g, "''")}'`;

    const query = `
    WITH
      toDateTime('${startTimestamp}') AS startDate,
      toDateTime('${endTimestamp}') AS endDate
    SELECT
      ClientName as name,
      ClientVersion as version,
      sum(TotalRequests) as requestCount,
      max(Timestamp) as lastUsed
    FROM ${opts.chClient.database}.operation_request_metrics_5_30
    WHERE Timestamp >= startDate AND Timestamp <= endDate
      AND OrganizationID = '${authContext.organizationId}'
      AND FederatedGraphID = '${graph.id}'
      AND OperationHash = '${req.operationHash.replace(/'/g, "''")}'
      ${operationNameFilter}
    GROUP BY ClientName, ClientVersion
    ORDER BY lastUsed DESC`;

    const res: Array<{
      name: string;
      version: string;
      requestCount: number;
      lastUsed: string;
    }> = await opts.chClient.queryPromise(query);

    const clients = res.map((client) => ({
      name: client.name || '',
      version: client.version || '',
      requestCount: BigInt(client.requestCount || 0),
      lastUsed: new Date(client.lastUsed + 'Z').toISOString(),
    }));

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      clients,
    };
  });
}
