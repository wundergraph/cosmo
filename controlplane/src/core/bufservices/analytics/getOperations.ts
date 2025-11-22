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
  SortDirection,
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

    // Default includeContent to false if not explicitly set to true
    const shouldIncludeContent = req.includeContent === true;

    // Only fetch deprecated fields info when includeHasDeprecatedFields is true
    const shouldIncludeHasDeprecatedFields = req.includeHasDeprecatedFields === true;
    let deprecatedFields: { name: string; typeNames: string[] }[] = [];
    if (shouldIncludeHasDeprecatedFields) {
      try {
        const latestValidSchemaVersion = await fedGraphRepo.getLatestValidSchemaVersion({
          targetId: graph.targetId,
        });
        if (latestValidSchemaVersion && latestValidSchemaVersion.schema) {
          const parsedSchema = parse(latestValidSchemaVersion.schema);
          const newGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
          const schemaGraphPruner = new SchemaGraphPruner(fedGraphRepo, subgraphRepo, usageRepo, newGraphQLSchema);
          const deprecatedFieldsList = schemaGraphPruner.getAllFields({
            schema: newGraphQLSchema,
            onlyDeprecated: true,
          });
          deprecatedFields = deprecatedFieldsList.map((field) => ({
            name: field.name,
            typeNames: [field.typeName],
          }));
        }
      } catch (error) {
        logger.error('Error getting latest valid schema version', { error });
      }
    }

    const filters: AnalyticsFilter[] = [];
    if (req.clientNames && req.clientNames.length > 0) {
      // Create an EQUALS filter for each client name
      // Multiple filters with the same field are combined with OR
      for (const clientName of req.clientNames) {
        filters.push(
          new AnalyticsFilter({
            field: 'clientName',
            operator: AnalyticsViewFilterOperator.EQUALS,
            value: clientName,
          }),
        );
      }
    }

    // Only get hasDeprecatedFields information when includeHasDeprecatedFields is true
    // Only filter by deprecated fields when includeOperationsWithDeprecatedFieldsOnly is true
    const sortDirectionStr =
      req.sortDirection === SortDirection.ASC ? 'asc' : req.sortDirection === SortDirection.DESC ? 'desc' : 'desc'; // default to desc

    const operations = await metricsRepo.getOperations({
      range,
      dateRange,
      organizationId: authContext.organizationId,
      graphId: graph.id,
      filters,
      limit: req.limit,
      offset: req.offset,
      fetchBasedOn: sortField,
      sortDirection: sortDirectionStr,
      searchQuery: req.searchQuery,
      deprecatedFields,
      includeOperationsWithDeprecatedFieldsOnly: req.includeOperationsWithDeprecatedFieldsOnly === true,
    });

    if (operations.length === 0) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        operations: [],
      };
    }

    // Fetch operation content for the operations we'll return
    let operationContentMap = new Map<string, string>();
    if (shouldIncludeContent && operations.length > 0) {
      const operationHashes = operations.map((op) => op.operationHash);
      operationContentMap = await cacheWarmerRepo.getOperationContent({
        operationHashes,
        federatedGraphID: graph.id,
        organizationID: authContext.organizationId,
        rangeInHours: range,
        dateRange,
      });
    }

    const computedOperations: GetOperationsResponse_Operation[] = [];
    for (const operation of operations) {
      // Build operation with only the relevant metric based on fetchBasedOn
      const operationData: any = {
        name: operation.operationName,
        hash: operation.operationHash,
        type:
          operation.operationType === 'query'
            ? GetOperationsResponse_OperationType.QUERY
            : operation.operationType === 'mutation'
              ? GetOperationsResponse_OperationType.MUTATION
              : GetOperationsResponse_OperationType.SUBSCRIPTION,
      };

      // Only set content when includeContent is true
      if (shouldIncludeContent) {
        const operationContent = operationContentMap.get(operation.operationHash) || '';
        operationData.content = operationContent;
      }

      // Only set hasDeprecatedFields when includeHasDeprecatedFields is true
      // hasDeprecatedFields is set by getOperationsWithDeprecatedFields when deprecatedFields are provided
      if (shouldIncludeHasDeprecatedFields) {
        operationData.hasDeprecatedFields = operation.hasDeprecatedFields || false;
      }

      // Set only the relevant metric based on fetchBasedOn using oneof structure
      if (fetchBasedOn === OperationsFetchBasedOn.REQUESTS) {
        operationData.metric = {
          case: 'requestCount',
          value: BigInt(operation.requestCount || 0),
        };
      } else if (fetchBasedOn === OperationsFetchBasedOn.ERRORS) {
        operationData.metric = {
          case: 'errorPercentage',
          value: operation.errorPercentage || 0,
        };
      } else {
        // Default to latency
        operationData.metric = {
          case: 'latency',
          value: operation.latency,
        };
      }

      computedOperations.push(new GetOperationsResponse_Operation(operationData));
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations: computedOperations,
    };
  });
}
