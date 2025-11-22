import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { buildASTSchema } from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationDeprecatedFieldsRequest,
  GetOperationDeprecatedFieldsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { parse } from 'graphql';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { UsageRepository } from '../../repositories/analytics/UsageRepository.js';
import type { RouterOptions } from '../../routes.js';
import SchemaGraphPruner from '../../services/SchemaGraphPruner.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { Field } from '../../../types/index.js';

export function getOperationDeprecatedFields(
  opts: RouterOptions,
  req: GetOperationDeprecatedFieldsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOperationDeprecatedFieldsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationDeprecatedFieldsResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        deprecatedFields: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

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
        deprecatedFields: [],
      };
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    // Use provided range/dateRange or fall back to default
    const inputRange = req.range ?? (req.dateRange ? undefined : 24);
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
        deprecatedFields: [],
      };
    }

    const latestValidSchemaVersion = await fedGraphRepo.getLatestValidSchemaVersion({
      targetId: graph.targetId,
    });
    let deprecatedFieldsUsedInOperation: {
      deprecatedFieldName: string;
      deprecatedFieldTypeNames: string[];
    }[] = [];
    let deprecatedFields: Field[] = [];
    try {
      if (latestValidSchemaVersion && latestValidSchemaVersion.schema) {
        const parsedSchema = parse(latestValidSchemaVersion.schema);
        const newGraphQLSchema = buildASTSchema(parsedSchema, { assumeValid: true, assumeValidSDL: true });
        const schemaGraphPruner = new SchemaGraphPruner(fedGraphRepo, subgraphRepo, usageRepo, newGraphQLSchema);
        deprecatedFields = schemaGraphPruner.getAllFields({ schema: newGraphQLSchema, onlyDeprecated: true });
        deprecatedFieldsUsedInOperation = await usageRepo.getDeprecatedFieldsUsedInOperation({
          organizationId: authContext.organizationId,
          federatedGraphId: graph.id,
          range,
          dateRange,
          deprecatedFields: deprecatedFields.map((field) => ({
            name: field.name,
            typeNames: [field.typeName],
          })),
          operationHash: req.operationHash.replace(/'/g, "''"),
          operationName: req.operationName?.replace(/'/g, "''"),
        });
      }
    } catch (error) {
      logger.error('Error getting latest valid schema version', { error });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      deprecatedFields: deprecatedFieldsUsedInOperation.map((field) => ({
        fieldName: field.deprecatedFieldName,
        typeName: field.deprecatedFieldTypeNames[0] || '',
        path:
          deprecatedFields.find(
            (f) => f.name === field.deprecatedFieldName && f.typeName === field.deprecatedFieldTypeNames[0],
          )?.path || '',
      })),
    };
  });
}
