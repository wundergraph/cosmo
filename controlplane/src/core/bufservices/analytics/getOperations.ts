/* eslint-disable camelcase */
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationsRequest,
  GetOperationsResponse,
  GetOperationsResponse_Operation,
  GetOperationsResponse_OperationType,
  AnalyticsViewFilterOperator,
  AnalyticsFilter,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';
import { CacheWarmerRepository } from '../../repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';

export function getOperations(
  opts: RouterOptions,
  req: GetOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationsResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        operations: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const metricsRepo = new MetricsRepository(opts.chClient);
    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient, opts.db);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        operations: [],
      };
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const limit = analyticsRetention?.limit ?? 7;

    const { range } = validateDateRanges({
      limit,
      range: limit * 24,
    });

    if (!range) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        operations: [],
      };
    }

    const operations = await metricsRepo.getOperations({
      range,
      organizationId: authContext.organizationId,
      graphId: graph.id,
      filters: req.clientName
        ? [
            new AnalyticsFilter({
              field: 'clientName',
              operator: AnalyticsViewFilterOperator.EQUALS,
              value: req.clientName,
            }),
          ]
        : [],
    });

    if (operations.length === 0) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        operations: [],
      };
    }

    const computedOperations: GetOperationsResponse_Operation[] = [];

    const operationHashes = operations.map((op) => op.operationHash);
    const operationContentMap = await cacheWarmerRepo.getOperationContent({
      operationHashes,
      federatedGraphID: graph.id,
      organizationID: authContext.organizationId,
      rangeInHours: range,
    });

    for (const operation of operations) {
      const operationContent = operationContentMap.get(operation.operationHash);
      if (!operationContent) {
        continue;
      }

      computedOperations.push(
        new GetOperationsResponse_Operation({
          name: operation.operationName,
          hash: operation.operationHash,
          latency: operation.latency,
          type:
            operation.operationType === 'query'
              ? GetOperationsResponse_OperationType.QUERY
              : operation.operationType === 'mutation'
                ? GetOperationsResponse_OperationType.MUTATION
                : GetOperationsResponse_OperationType.SUBSCRIPTION,
          content: operationContent,
        }),
      );
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations: computedOperations,
    };
  });
}
