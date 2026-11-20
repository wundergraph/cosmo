import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationContentRequest,
  GetOperationContentResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { PlainMessage } from '../../../types/index.js';
import { authenticateAnalyticsRead } from '../../util/analytics/auth.js';

// Get operation content by hash
// TODO: Specify daterange to improve clickhouse performance
export function getOperationContent(
  opts: RouterOptions,
  req: GetOperationContentRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOperationContentResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationContentResponse>>(ctx, logger, async () => {
    const authContext = await authenticateAnalyticsRead(opts, ctx);
    logger = enrichLogger(ctx, logger, authContext);

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        operationContent: '',
      };
    }

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        operationContent: '',
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    // Documents are kept for 90 days and written at most once per 30 days, so their own timestamp can't bound
    // retention. Only return a document whose operation had traffic inside the plan's analytics retention.
    // The traffic is read from GraphQL metrics, the pipeline that also stores the documents, so routers that
    // don't export OTEL metrics still find them. Its rows are daily, so the boundary rounds down to the day.
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });
    const traffic = await opts.chClient.queryPromise(
      `
      SELECT 1 AS hasTraffic
      FROM ${opts.chClient.database}.gql_metrics_schema_usage_lite_1d_90d
      WHERE OrganizationID = {organizationId:String}
      AND FederatedGraphID = {federatedGraphId:String}
      AND OperationHash = {operationHash:String}
      AND Timestamp >= toStartOfDay(now() - toIntervalDay({retentionDays:UInt32}))
      LIMIT 1
    `,
      {
        organizationId: authContext.organizationId,
        federatedGraphId: graph.id,
        operationHash: req.hash,
        retentionDays: analyticsRetention?.limit ?? 7,
      },
    );
    if (!Array.isArray(traffic) || traffic.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: "Operation not found within your plan's retention.",
        },
        operationContent: '',
      };
    }

    const query = `
      SELECT OperationContent as operationContent
      FROM ${opts.chClient?.database}.gql_metrics_operations
      WHERE OrganizationID = {organizationId:String} 
      AND FederatedGraphID = {federatedGraphId:String}
      AND OperationHash = {operationHash:String}
      ${req.name === undefined ? '' : 'AND OperationName = {operationName:String}'}
      LIMIT 1 SETTINGS use_query_cache = true, query_cache_ttl = 2629800
    `;

    const params: Record<string, string | number | boolean> = {
      organizationId: authContext.organizationId,
      federatedGraphId: graph.id,
      operationHash: req.hash.replace(/'/g, "''"),
    };

    if (req.name !== undefined) {
      params.operationName = req.name.replace(/'/g, "''");
    }

    const result = await opts.chClient.queryPromise(query, params);

    if (!Array.isArray(result) || result.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested operation not found',
        },
        operationContent: '',
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operationContent: result[0].operationContent,
    };
  });
}
