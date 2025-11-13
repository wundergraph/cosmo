/* eslint-disable camelcase */
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AnalyticsFilter,
  AnalyticsViewFilterOperator,
  GetOperationsRequest,
  GetOperationsResponse,
  GetOperationsResponse_Operation,
  GetOperationsResponse_OperationType,
  OperationsFetchBasedOn,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { buildASTSchema } from '@wundergraph/composition';
import { parse } from 'graphql';
import { deafultRangeInHoursForGetOperations } from '../../constants.js';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';
import { CacheWarmerRepository } from '../../repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import SchemaGraphPruner from '../../services/SchemaGraphPruner.js';
import { UsageRepository } from '../../repositories/analytics/UsageRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';

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
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const usageRepo = new UsageRepository(opts.chClient);
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

    req.limit = req.limit ?? 100;
    req.offset = req.offset ?? 0;
    // Validate limit is within reasonable bounds
    if (req.limit < 1 || req.limit > 1000) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Limit must be between 1 and 1000',
        },
        operations: [],
      };
    }

    // Validate offset
    if (req.offset < 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Offset must be >= 0',
        },
        operations: [],
      };
    }

    // Convert enum to string for repository method, default to latency for backwards compatibility
    const fetchBasedOn = req.fetchBasedOn ?? OperationsFetchBasedOn.LATENCY;
    const sortField =
      fetchBasedOn === OperationsFetchBasedOn.REQUESTS
        ? 'requests'
        : fetchBasedOn === OperationsFetchBasedOn.ERRORS
          ? 'errors'
          : 'latency'; // default to latency

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    // Use provided range/dateRange or fall back to default
    const inputRange = req.range ?? (req.dateRange ? undefined : deafultRangeInHoursForGetOperations);
    const { range, dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      range: inputRange,
      dateRange: req.dateRange,
    });

    if (!range && !dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        operations: [],
      };
    }

    // Default includeContent to true if not explicitly set to false
    const shouldIncludeContent = req.includeContent !== false;

    // Get deprecated fields info if needed
    const latestValidSchemaVersion = await fedGraphRepo.getLatestValidSchemaVersion({
      targetId: graph.targetId,
    });
    let operationsUsingDeprecatedFields: {
      operationHash: string;
      operationName: string;
    }[] = [];
    try {
      if (latestValidSchemaVersion && latestValidSchemaVersion.schema) {
        const parsedSchema = parse(latestValidSchemaVersion.schema);
        const newGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
        const schemaGraphPruner = new SchemaGraphPruner(fedGraphRepo, subgraphRepo, usageRepo, newGraphQLSchema);
        const deprecatedFields = schemaGraphPruner.getAllFields({ schema: newGraphQLSchema, onlyDeprecated: true });
        operationsUsingDeprecatedFields = await usageRepo.getOperationsUsingDeprecatedFields({
          organizationId: authContext.organizationId,
          federatedGraphId: graph.id,
          range,
          dateRange,
          deprecatedFields: deprecatedFields.map((field) => ({
            name: field.name,
            typeNames: [field.typeName],
          })),
        });
      }
    } catch (error) {
      logger.error('Error getting latest valid schema version', { error });
    }

    // If includeDeprecatedFields is true, fetch all operations without limit/offset
    // Then filter and apply pagination in memory
    const shouldFetchAll = req.includeDeprecatedFields === true;

    const operations = await metricsRepo.getOperations({
      range,
      dateRange,
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
      limit: req.limit,
      offset: shouldFetchAll ? 0 : req.offset,
      fetchBasedOn: sortField,
      sortDirection: req.sortDirection || 'desc',
      searchQuery: (req as any).searchQuery,
      fetchAll: shouldFetchAll,
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
    let operationsToProcess = operations;

    // If we fetched all operations (for deprecated fields), we need to:
    // 1. Merge with operations that have deprecated fields
    // 2. Filter by deprecated fields if needed
    // 3. Apply pagination
    if (shouldFetchAll) {
      // Create a set of operations with deprecated fields for quick lookup
      const deprecatedOpsSet = new Set(
        operationsUsingDeprecatedFields.map((op) => `${op.operationHash}:${op.operationName}`),
      );

      // Mark operations with deprecated fields
      const operationsWithDeprecatedInfo = operations.map((op) => ({
        ...op,
        hasDeprecatedFields: deprecatedOpsSet.has(`${op.operationHash}:${op.operationName}`),
      }));

      // Filter by deprecated fields if needed
      if (req.includeOperationsWithDeprecatedFieldsOnly) {
        operationsToProcess = operationsWithDeprecatedInfo.filter((op) => op.hasDeprecatedFields);
      } else {
        operationsToProcess = operationsWithDeprecatedInfo;
      }

      // Apply pagination
      operationsToProcess = operationsToProcess.slice(req.offset, req.offset + req.limit);
    }

    // Fetch operation content for the operations we'll return
    let operationContentMap = new Map<string, string>();
    if (shouldIncludeContent && operationsToProcess.length > 0) {
      const operationHashes = operationsToProcess.map((op) => op.operationHash);
      operationContentMap = await cacheWarmerRepo.getOperationContent({
        operationHashes,
        federatedGraphID: graph.id,
        organizationID: authContext.organizationId,
        rangeInHours: range,
        dateRange,
      });
    }

    for (const operation of operationsToProcess) {
      const operationContent = shouldIncludeContent ? operationContentMap.get(operation.operationHash) || '' : '';

      const hasDeprecatedFields = operationsUsingDeprecatedFields.some(
        (op) => op.operationHash === operation.operationHash && op.operationName === operation.operationName,
      );

      computedOperations.push(
        new GetOperationsResponse_Operation({
          name: operation.operationName,
          hash: operation.operationHash,
          latency: operation.latency,
          hasDeprecatedFields,
          type:
            operation.operationType === 'query'
              ? GetOperationsResponse_OperationType.QUERY
              : operation.operationType === 'mutation'
                ? GetOperationsResponse_OperationType.MUTATION
                : GetOperationsResponse_OperationType.SUBSCRIPTION,
          content: operationContent,
          requestCount: BigInt(operation.requestCount || 0),
          errorCount: BigInt(operation.errorCount || 0),
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
