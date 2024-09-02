import { GraphPruningConfig, LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { GraphPruningRuleEnum } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import { namespaceGraphPruningCheckConfig, schemaCheckGraphPruningAction } from '../../db/schema.js';
import { GraphPruningIssueResult, LintSeverityLevel, SchemaGraphPruningDTO } from '../../types/index.js';

export class SchemaGraphPruningRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async getNamespaceGraphPruningConfig(namespaceId: string): Promise<SchemaGraphPruningDTO[]> {
    const orgGraphPruningConfigs = await this.db
      .select({
        graphPruningRule: namespaceGraphPruningCheckConfig.graphPruningRule,
        severityLevel: namespaceGraphPruningCheckConfig.severityLevel,
        gracePeriod: namespaceGraphPruningCheckConfig.gracePeriod,
      })
      .from(namespaceGraphPruningCheckConfig)
      .where(eq(namespaceGraphPruningCheckConfig.namespaceId, namespaceId))
      .execute();

    return orgGraphPruningConfigs.map((l) => {
      return {
        ruleName: l.graphPruningRule as GraphPruningRuleEnum,
        severity: l.severityLevel as LintSeverityLevel,
        gracePeriod: l.gracePeriod,
      } as SchemaGraphPruningDTO;
    });
  }

  public async configureNamespaceGraphPruningConfigs({
    namespaceId,
    graphPruningConfigs,
  }: {
    namespaceId: string;
    graphPruningConfigs: GraphPruningConfig[];
  }) {
    await this.db
      .delete(namespaceGraphPruningCheckConfig)
      .where(eq(namespaceGraphPruningCheckConfig.namespaceId, namespaceId));

    if (graphPruningConfigs.length > 0) {
      await this.db.insert(namespaceGraphPruningCheckConfig).values(
        graphPruningConfigs.map((l) => {
          return {
            namespaceId,
            graphPruningRule: l.ruleName as GraphPruningRuleEnum,
            severityLevel:
              l.severityLevel === LintSeverity.error ? ('error' as LintSeverityLevel) : ('warn' as LintSeverityLevel),
            gracePeriod: l.gracePeriod,
          };
        }),
      );
    }
  }

  public async addSchemaCheckGraphPruningIssues({
    schemaCheckId,
    graphPruningIssues,
  }: {
    schemaCheckId: string;
    graphPruningIssues: GraphPruningIssueResult[];
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
      })
      .from(schemaCheckGraphPruningAction)
      .innerJoin(schema.federatedGraphs, eq(schema.federatedGraphs.id, schemaCheckGraphPruningAction.federatedGraphId))
      .innerJoin(schema.targets, eq(schema.targets.id, schema.federatedGraphs.targetId))
      .where(
        and(
          eq(schemaCheckGraphPruningAction.schemaCheckId, schemaCheckId),
          eq(schemaCheckGraphPruningAction.federatedGraphId, federatedGraphId),
        ),
      );

    const graphPruningResult = graphPruningIssues.map((l) => {
      const issue: GraphPruningIssueResult = {
        fieldPath: l.fieldPath,
        graphPruningRuleType: l.graphPruningRuleType,
        issueLocation: l.location,
        message: l.message || '',
        severity: l.isError ? LintSeverity.error : LintSeverity.warn,
        federatedGraphId: l.federatedGraphId,
        federatedGraphName: l.federatedGraphName,
      };
      return issue;
    });

    const graphPruningErrors = graphPruningResult.filter((l) => l.severity === LintSeverity.error);
    const graphPruningWarnings = graphPruningResult.filter((l) => l.severity === LintSeverity.warn);

    return [...graphPruningErrors, ...graphPruningWarnings];
  }
}
