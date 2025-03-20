import { GraphPruningConfig, LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { GraphQLSchema } from 'graphql';
import { GraphPruningRuleEnum } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import {
  namespaceGraphPruningCheckConfig,
  schemaCheckGraphPruningAction,
  schemaCheckSubgraphs,
} from '../../db/schema.js';
import {
  GraphPruningIssueResult,
  LintSeverityLevel,
  SchemaGraphPruningDTO,
  SchemaGraphPruningIssues,
  SubgraphDTO,
} from '../../types/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { GetDiffBetweenGraphsSuccess } from '../composition/schemaCheck.js';
import SchemaGraphPruner from '../services/SchemaGraphPruner.js';
import { UsageRepository } from './analytics/UsageRepository.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';

export class SchemaGraphPruningRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async getNamespaceGraphPruningConfig(namespaceId: string): Promise<SchemaGraphPruningDTO[]> {
    const orgGraphPruningConfigs = await this.db
      .select({
        graphPruningRule: namespaceGraphPruningCheckConfig.graphPruningRule,
        severityLevel: namespaceGraphPruningCheckConfig.severityLevel,
        gracePeriodInDays: namespaceGraphPruningCheckConfig.gracePeriod,
        schemaUsageCheckPeriodInDays: namespaceGraphPruningCheckConfig.schemaUsageCheckPeriod,
      })
      .from(namespaceGraphPruningCheckConfig)
      .where(eq(namespaceGraphPruningCheckConfig.namespaceId, namespaceId))
      .execute();

    return orgGraphPruningConfigs.map((l) => {
      const graphPruningDTO: SchemaGraphPruningDTO = {
        ruleName: l.graphPruningRule as GraphPruningRuleEnum,
        severity: l.severityLevel as LintSeverityLevel,
        gracePeriodInDays: l.gracePeriodInDays,
        schemaUsageCheckPeriodInDays: l.schemaUsageCheckPeriodInDays || undefined,
      };
      return graphPruningDTO;
    });
  }

  public configureNamespaceGraphPruningConfigs({
    namespaceId,
    graphPruningConfigs,
  }: {
    namespaceId: string;
    graphPruningConfigs: GraphPruningConfig[];
  }) {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(namespaceGraphPruningCheckConfig)
        .where(eq(namespaceGraphPruningCheckConfig.namespaceId, namespaceId));

      if (graphPruningConfigs.length > 0) {
        await tx.insert(namespaceGraphPruningCheckConfig).values(
          graphPruningConfigs.map((l) => {
            return {
              namespaceId,
              graphPruningRule: l.ruleName as GraphPruningRuleEnum,
              severityLevel:
                l.severityLevel === LintSeverity.error ? ('error' as LintSeverityLevel) : ('warn' as LintSeverityLevel),
              gracePeriod: l.gracePeriodInDays,
              schemaUsageCheckPeriod: l.schemaUsageCheckPeriodInDays,
            };
          }),
        );
      }
    });
  }

  public async addSchemaCheckGraphPruningIssues({
    schemaCheckId,
    graphPruningIssues,
    schemaCheckSubgraphId,
  }: {
    schemaCheckId: string;
    graphPruningIssues: GraphPruningIssueResult[];
    schemaCheckSubgraphId: string;
  }) {
    if (graphPruningIssues.length > 0) {
      await this.db.insert(schemaCheckGraphPruningAction).values(
        graphPruningIssues.map((l) => {
          return {
            graphPruningRuleType: l.graphPruningRuleType,
            schemaCheckId,
            fieldPath: l.fieldPath,
            message: l.message,
            location: l.issueLocation,
            isError: l.severity === LintSeverity.error,
            federatedGraphId: l.federatedGraphId,
            schemaCheckSubgraphId,
          };
        }),
      );
    }
  }

  public async getSchemaCheckGraphPruningIsssues({
    schemaCheckId,
    federatedGraphId,
  }: {
    schemaCheckId: string;
    federatedGraphId: string;
  }): Promise<GraphPruningIssueResult[]> {
    const graphPruningIssues = await this.db
      .select({
        fieldPath: schemaCheckGraphPruningAction.fieldPath,
        message: schemaCheckGraphPruningAction.message,
        location: schemaCheckGraphPruningAction.location,
        isError: schemaCheckGraphPruningAction.isError,
        graphPruningRuleType: schemaCheckGraphPruningAction.graphPruningRuleType,
        federatedGraphId: schemaCheckGraphPruningAction.federatedGraphId,
        federatedGraphName: schema.targets.name,
        subgraphName: schemaCheckSubgraphs.subgraphName,
      })
      .from(schemaCheckGraphPruningAction)
      .innerJoin(schema.federatedGraphs, eq(schema.federatedGraphs.id, schemaCheckGraphPruningAction.federatedGraphId))
      .innerJoin(schema.targets, eq(schema.targets.id, schema.federatedGraphs.targetId))
      .leftJoin(schemaCheckSubgraphs, eq(schemaCheckSubgraphs.id, schemaCheckGraphPruningAction.schemaCheckSubgraphId))
      .where(
        and(
          eq(schemaCheckGraphPruningAction.schemaCheckId, schemaCheckId),
          eq(schemaCheckGraphPruningAction.federatedGraphId, federatedGraphId),
        ),
      );

    const graphPruningErrors: GraphPruningIssueResult[] = [];
    const graphPruningWarnings: GraphPruningIssueResult[] = [];

    for (const g of graphPruningIssues) {
      const issue: GraphPruningIssueResult = {
        fieldPath: g.fieldPath,
        graphPruningRuleType: g.graphPruningRuleType,
        issueLocation: g.location,
        message: g.message || '',
        severity: g.isError ? LintSeverity.error : LintSeverity.warn,
        federatedGraphId: g.federatedGraphId,
        federatedGraphName: g.federatedGraphName,
        subgraphName: g.subgraphName || undefined,
      };

      if (g.isError) {
        graphPruningErrors.push(issue);
      } else {
        graphPruningWarnings.push(issue);
      }
    }

    return [...graphPruningErrors, ...graphPruningWarnings];
  }

  public async performSchemaGraphPruningCheck({
    newGraphQLSchema,
    namespaceID,
    organizationID,
    schemaCheckID,
    isGraphPruningEnabled,
    subgraph,
    chClient,
    schemaChanges,
    rangeInDays,
    subgraphRepo,
    fedGraphRepo,
    schemaCheckSubgraphId,
  }: {
    newGraphQLSchema: GraphQLSchema | undefined;
    namespaceID: string;
    organizationID: string;
    schemaCheckID: string;
    isGraphPruningEnabled: boolean;
    subgraph: SubgraphDTO;
    chClient: ClickHouseClient | undefined;
    schemaChanges: GetDiffBetweenGraphsSuccess;
    rangeInDays: number;
    fedGraphRepo: FederatedGraphRepository;
    subgraphRepo: SubgraphRepository;
    schemaCheckSubgraphId: string;
  }) {
    let graphPruningIssues: SchemaGraphPruningIssues = { warnings: [], errors: [] };
    if (isGraphPruningEnabled && chClient && newGraphQLSchema) {
      const graphPruningConfigs = await this.getNamespaceGraphPruningConfig(namespaceID);
      if (graphPruningConfigs.length > 0) {
        const usageRepo = new UsageRepository(chClient);
        const schemaGraphPruner = new SchemaGraphPruner(fedGraphRepo, subgraphRepo, usageRepo, newGraphQLSchema);

        graphPruningIssues = await schemaGraphPruner.schemaGraphPruneCheck({
          subgraph,
          graphPruningConfigs,
          updatedFields: schemaChanges.changes.filter(
            (change) =>
              change.changeType === 'FIELD_ADDED' ||
              change.changeType === 'FIELD_TYPE_CHANGED' ||
              change.changeType === 'INPUT_FIELD_ADDED' ||
              change.changeType === 'INPUT_FIELD_TYPE_CHANGED' ||
              change.changeType === 'FIELD_ARGUMENT_ADDED' ||
              change.changeType === 'FIELD_ARGUMENT_REMOVED' ||
              change.changeType === 'FIELD_DEPRECATION_ADDED',
          ),
          removedFields: schemaChanges.changes.filter(
            (change) => change.changeType === 'FIELD_REMOVED' || change.changeType === 'INPUT_FIELD_REMOVED',
          ),
          organizationId: organizationID,
          rangeInDays,
        });

        await this.addSchemaCheckGraphPruningIssues({
          schemaCheckId: schemaCheckID,
          graphPruningIssues: [...graphPruningIssues.warnings, ...graphPruningIssues.errors],
          schemaCheckSubgraphId,
        });
      }
    }
    return graphPruningIssues;
  }
}
