import { GraphQLSchema, isInputObjectType, isInterfaceType, isObjectType } from 'graphql';
import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import pLimit from 'p-limit';
import { LATEST_ROUTER_COMPATIBILITY_VERSION } from '@wundergraph/composition';
import {
  FederatedGraphDTO,
  Field,
  GraphPruningIssueResult,
  LintSeverityLevel,
  SchemaGraphPruningDTO,
  SchemaGraphPruningIssues,
  SubgraphDTO,
} from '../../types/index.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { UsageRepository } from '../repositories/analytics/UsageRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { buildSchema } from '../composition/composition.js';
import { getFederatedGraphRouterCompatibilityVersion } from '../util.js';
import { traced } from '../tracing.js';

@traced
export default class SchemaGraphPruner {
  constructor(
    private federatedGraphRepo: FederatedGraphRepository,
    private subgraphRepo: SubgraphRepository,
    private usageRepo: UsageRepository,
    private schema: GraphQLSchema,
  ) {}

  private usedFieldPathsByGraphAndRange = new Map<string, Promise<Set<string>>>();

  private getUsedFieldPathsByGraph({
    organizationId,
    federatedGraphs,
    rangeInDays,
  }: {
    organizationId: string;
    federatedGraphs: FederatedGraphDTO[];
    rangeInDays: number;
  }): Promise<{ graph: FederatedGraphDTO; usedFieldPaths: Set<string> }[]> {
    const limit = pLimit(5);
    return Promise.all(
      federatedGraphs.map(async (graph) => {
        const key = `${graph.id}:${rangeInDays}`;
        let usedFieldPaths = this.usedFieldPathsByGraphAndRange.get(key);
        if (!usedFieldPaths) {
          usedFieldPaths = limit(() =>
            this.usageRepo.getUsedFieldPaths({
              organizationId,
              federatedGraphId: graph.id,
              rangeInHours: rangeInDays * 24,
            }),
          ).then((paths) => new Set(paths));
          this.usedFieldPathsByGraphAndRange.set(key, usedFieldPaths);
        }
        return { graph, usedFieldPaths: await usedFieldPaths };
      }),
    );
  }

  private createGraphPruningIssue({
    field,
    graph,
    ruleType,
    severityLevel,
    message,
  }: {
    field: Field;
    graph: FederatedGraphDTO;
    ruleType: GraphPruningIssueResult['graphPruningRuleType'];
    severityLevel: LintSeverityLevel;
    message: string;
  }): GraphPruningIssueResult {
    return {
      graphPruningRuleType: ruleType,
      severity: severityLevel === 'error' ? LintSeverity.error : LintSeverity.warn,
      fieldPath: field.path,
      message,
      issueLocation: {
        line: field.location.line || 0,
        column: field.location.column || 0,
        endLine: field.location.endLine,
        endColumn: field.location.endColumn,
      },
      federatedGraphId: graph.id,
      federatedGraphName: graph.name,
    };
  }

  getAllFields({ schema, onlyDeprecated }: { schema?: GraphQLSchema; onlyDeprecated?: boolean }): Field[] {
    const fields: Field[] = [];
    const schemaToBeUsed = schema || this.schema;

    // fetching all the types from the schema
    const types = schemaToBeUsed.getTypeMap();

    for (const typeName in types) {
      const type = types[typeName];
      // skipping unwanted types
      if (typeName.startsWith('__')) {
        continue;
      }

      // checking if the type is an object type, interface type, or input object type
      if (!isObjectType(type) && !isInterfaceType(type) && !isInputObjectType(type)) {
        continue;
      }

      // fetching all the fields from the type
      const fieldMap = type.getFields();

      for (const fieldName in fieldMap) {
        const field = fieldMap[fieldName];
        if (onlyDeprecated && !field.deprecationReason) {
          continue;
        }
        fields.push({
          name: field.name,
          typeName,
          path: `${typeName}.${field.name}`,
          location: {
            line: field.astNode?.loc?.startToken.line,
            column: field.astNode?.loc?.startToken.column,
            endLine: field.astNode?.loc?.endToken.line,
            endColumn: field.astNode?.loc?.endToken.column,
          },
          isDeprecated: !!field.deprecationReason,
          deprecationReason: field.deprecationReason || undefined,
        });
      }
    }

    return fields;
  }

  async fetchUnusedFields({
    subgraphId,
    namespaceId,
    organizationId,
    federatedGraphs,
    rangeInDays,
    addedFields,
    severityLevel,
  }: {
    federatedGraphs: FederatedGraphDTO[];
    subgraphId: string;
    namespaceId: string;
    organizationId: string;
    rangeInDays: number;
    // fields that were added in the proposed schema passed to the check command
    addedFields: SchemaDiff[];
    severityLevel: LintSeverityLevel;
  }): Promise<GraphPruningIssueResult[]> {
    const fieldsInGracePeriod = await this.subgraphRepo.getSubgraphFieldsInGracePeriod({ subgraphId, namespaceId });

    const recentlyAddedPaths = new Set([...fieldsInGracePeriod, ...addedFields].map((f) => f.path));
    const fieldsToBeChecked = this.getAllFields({}).filter((field) => !recentlyAddedPaths.has(field.path));

    if (fieldsToBeChecked.length === 0) {
      return [];
    }

    const usage = await this.getUsedFieldPathsByGraph({ organizationId, federatedGraphs, rangeInDays });

    return usage.flatMap(({ graph, usedFieldPaths }) =>
      fieldsToBeChecked
        .filter((field) => !usedFieldPaths.has(field.path))
        .map((field) =>
          this.createGraphPruningIssue({
            field,
            graph,
            ruleType: 'UNUSED_FIELDS',
            severityLevel,
            message: `Field ${field.name} of type ${field.typeName} has not been used in the past ${rangeInDays} days`,
          }),
        ),
    );
  }

  async fetchDeprecatedFields({
    subgraphId,
    namespaceId,
    organizationId,
    federatedGraphs,
    rangeInDays,
    severityLevel,
    addedDeprecatedFields,
  }: {
    federatedGraphs: FederatedGraphDTO[];
    subgraphId: string;
    namespaceId: string;
    organizationId: string;
    rangeInDays: number;
    severityLevel: LintSeverityLevel;
    addedDeprecatedFields: SchemaDiff[];
  }): Promise<GraphPruningIssueResult[]> {
    const deprecatedFieldsInGracePeriod = await this.subgraphRepo.getSubgraphFieldsInGracePeriod({
      subgraphId,
      namespaceId,
      onlyDeprecated: true,
    });

    const recentlyDeprecatedPaths = new Set(
      [...deprecatedFieldsInGracePeriod, ...addedDeprecatedFields].map((f) => f.path),
    );
    const deprecatedFieldsToBeChecked = this.getAllFields({ onlyDeprecated: true }).filter(
      (field) => !recentlyDeprecatedPaths.has(field.path),
    );

    if (deprecatedFieldsToBeChecked.length === 0) {
      return [];
    }

    const usage = await this.getUsedFieldPathsByGraph({ organizationId, federatedGraphs, rangeInDays });

    return usage.flatMap(({ graph, usedFieldPaths }) =>
      deprecatedFieldsToBeChecked.map((field) =>
        this.createGraphPruningIssue({
          field,
          graph,
          ruleType: 'DEPRECATED_FIELDS',
          severityLevel,
          message: usedFieldPaths.has(field.path)
            ? `Field ${field.name} of type ${field.typeName} was deprecated, but is still in use despite the expiration of the grace period.`
            : `Field ${field.name} of type ${field.typeName} was deprecated, is no longer in use, and is now safe for removal following the expiration of the grace period.`,
        }),
      ),
    );
  }

  fetchNonDeprecatedDeletedFields({
    federatedGraphs,
    severityLevel,
    removedFields,
    oldSchema,
  }: {
    federatedGraphs: FederatedGraphDTO[];
    severityLevel: LintSeverityLevel;
    removedFields: SchemaDiff[];
    oldSchema: string;
  }): GraphPruningIssueResult[] {
    let oldGraphQLSchema: GraphQLSchema | undefined;

    try {
      const result = buildSchema(
        oldSchema,
        false,
        /*
         * If there are any federated graphs for which the subgraph is a constituent, the subgraph will be validated
         * against the first router compatibility version encountered.
         * If no federated graphs have yet been created, the subgraph will be validated against the latest router
         * compatibility version.
         */
        getFederatedGraphRouterCompatibilityVersion(federatedGraphs),
      );
      if (!result.success) {
        oldGraphQLSchema = undefined;
      }
      if (result.success) {
        oldGraphQLSchema = result.schema;
      }
    } catch {
      oldGraphQLSchema = undefined;
    }

    const deprecatedPaths = new Set(
      this.getAllFields({ schema: oldGraphQLSchema, onlyDeprecated: true }).map((f) => f.path),
    );
    const nonDeprecatedDeletedFields = removedFields.filter((field) => !deprecatedPaths.has(field.path));
    const graphPruningIssues: GraphPruningIssueResult[] = [];

    for (const federatedGraph of federatedGraphs) {
      for (const field of nonDeprecatedDeletedFields) {
        const [typeName, name] = field.path.split('.');
        graphPruningIssues.push({
          graphPruningRuleType: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
          severity: severityLevel === 'error' ? LintSeverity.error : LintSeverity.warn,
          fieldPath: field.path,
          message: `Field ${name} of type ${typeName} was removed without being deprecated first.`,
          issueLocation: {
            line: 0,
            column: 0,
            endLine: 0,
            endColumn: 0,
          },
          federatedGraphId: federatedGraph.id,
          federatedGraphName: federatedGraph.name,
        });
      }
    }

    return graphPruningIssues;
  }

  async schemaGraphPruneCheck({
    subgraph,
    graphPruningConfigs,
    organizationId,
    rangeInDays,
    updatedFields,
    removedFields,
  }: {
    subgraph: SubgraphDTO;
    graphPruningConfigs: SchemaGraphPruningDTO[];
    organizationId: string;
    rangeInDays: number;
    // fields that were added/updated in the proposed schema passed to the check command
    updatedFields: SchemaDiff[];
    removedFields: SchemaDiff[];
  }): Promise<SchemaGraphPruningIssues> {
    const graphPruneWarnings: GraphPruningIssueResult[] = [];
    const graphPruneErrors: GraphPruningIssueResult[] = [];

    const federatedGraphs = await this.federatedGraphRepo.bySubgraphLabels({
      labels: subgraph.labels,
      namespaceId: subgraph.namespaceId,
      excludeContracts: false,
    });

    for (const graphPruningConfig of graphPruningConfigs) {
      const { ruleName, severity, schemaUsageCheckPeriodInDays } = graphPruningConfig;

      switch (ruleName) {
        case 'UNUSED_FIELDS': {
          const unusedFields = await this.fetchUnusedFields({
            subgraphId: subgraph.id,
            namespaceId: subgraph.namespaceId,
            organizationId,
            federatedGraphs,
            rangeInDays: schemaUsageCheckPeriodInDays || rangeInDays,
            addedFields: updatedFields.filter((field) => field.changeType !== 'FIELD_DEPRECATION_ADDED'),
            severityLevel: severity,
          });

          if (severity === 'error') {
            graphPruneErrors.push(...unusedFields);
          } else {
            graphPruneWarnings.push(...unusedFields);
          }

          break;
        }
        case 'DEPRECATED_FIELDS': {
          const deprecatedFields = await this.fetchDeprecatedFields({
            subgraphId: subgraph.id,
            namespaceId: subgraph.namespaceId,
            organizationId,
            federatedGraphs,
            rangeInDays: schemaUsageCheckPeriodInDays || rangeInDays,
            severityLevel: severity,
            addedDeprecatedFields: updatedFields.filter((field) => field.changeType === 'FIELD_DEPRECATION_ADDED'),
          });

          if (severity === 'error') {
            graphPruneErrors.push(...deprecatedFields);
          } else {
            graphPruneWarnings.push(...deprecatedFields);
          }

          break;
        }
        case 'REQUIRE_DEPRECATION_BEFORE_DELETION': {
          const nonDeprecatedDeletedFields = this.fetchNonDeprecatedDeletedFields({
            oldSchema: subgraph.schemaSDL,
            federatedGraphs,
            severityLevel: severity,
            removedFields,
          });

          if (severity === 'error') {
            graphPruneErrors.push(...nonDeprecatedDeletedFields);
          } else {
            graphPruneWarnings.push(...nonDeprecatedDeletedFields);
          }

          break;
        }
        default: {
          throw new Error(`Unknown graph pruning rule: ${ruleName}`);
        }
      }
    }

    return {
      warnings: graphPruneWarnings,
      errors: graphPruneErrors,
    };
  }
}
