import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { LintConfig, LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import * as schema from '../../db/schema.js';
import { namespaceLintCheckConfig, schemaCheckLintAction, schemaCheckSubgraphs } from '../../db/schema.js';
import { SchemaLintDTO, LintSeverityLevel, LintIssueResult, SchemaLintIssues } from '../../types/index.js';
import { LintRuleEnum } from '../../db/models.js';
import SchemaLinter from '../services/SchemaLinter.js';

export class SchemaLintRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async getNamespaceLintConfig(namespaceId: string): Promise<SchemaLintDTO[]> {
    const orgLintConfigs = await this.db
      .select({
        lintRule: namespaceLintCheckConfig.lintRule,
        severityLevel: namespaceLintCheckConfig.severityLevel,
      })
      .from(namespaceLintCheckConfig)
      .where(eq(namespaceLintCheckConfig.namespaceId, namespaceId))
      .execute();

    return orgLintConfigs.map((l) => {
      return {
        ruleName: l.lintRule as LintRuleEnum,
        severity: l.severityLevel as LintSeverityLevel,
      } as SchemaLintDTO;
    });
  }

  public async configureNamespaceLintConfig({
    namespaceId,
    lintConfigs,
  }: {
    namespaceId: string;
    lintConfigs: LintConfig[];
  }) {
    await this.db.delete(namespaceLintCheckConfig).where(eq(namespaceLintCheckConfig.namespaceId, namespaceId));

    if (lintConfigs.length > 0) {
      await this.db.insert(namespaceLintCheckConfig).values(
        lintConfigs.map((l) => {
          return {
            namespaceId,
            lintRule: l.ruleName as LintRuleEnum,
            severityLevel:
              l.severityLevel === LintSeverity.error ? ('error' as LintSeverityLevel) : ('warn' as LintSeverityLevel),
          };
        }),
      );
    }
  }

  public async addSchemaCheckLintIssues({
    schemaCheckId,
    lintIssues,
    schemaCheckSubgraphId,
  }: {
    schemaCheckId: string;
    lintIssues: LintIssueResult[];
    schemaCheckSubgraphId: string;
  }) {
    if (lintIssues.length > 0) {
      await this.db.insert(schemaCheckLintAction).values(
        lintIssues.map((l) => {
          return {
            lintRuleType: l.lintRuleType || null,
            schemaCheckId,
            message: l.message,
            location: l.issueLocation,
            isError: l.severity === LintSeverity.error,
            schemaCheckSubgraphId,
          };
        }),
      );
    }
  }

  public async getSchemaCheckLintIsssues({ schemaCheckId }: { schemaCheckId: string }): Promise<LintIssueResult[]> {
    const lintIssues = await this.db
      .select({
        message: schemaCheckLintAction.message,
        location: schemaCheckLintAction.location,
        isError: schemaCheckLintAction.isError,
        lintRuleType: schemaCheckLintAction.lintRuleType,
        subgraphName: schemaCheckSubgraphs.subgraphName,
      })
      .from(schemaCheckLintAction)
      .leftJoin(schemaCheckSubgraphs, eq(schemaCheckSubgraphs.id, schemaCheckLintAction.schemaCheckSubgraphId))
      .where(eq(schemaCheckLintAction.schemaCheckId, schemaCheckId));

    return lintIssues.map((l) => {
      return {
        lintRuleType: l.lintRuleType || undefined,
        issueLocation: l.location,
        message: l.message,
        severity: l.isError ? LintSeverity.error : LintSeverity.warn,
        subgraphName: l.subgraphName,
      } as LintIssueResult;
    });
  }

  public async performSchemaLintCheck({
    newSchemaSDL,
    namespaceId,
    schemaCheckID,
    isLintingEnabled,
    schemaCheckSubgraphId,
  }: {
    newSchemaSDL: string;
    namespaceId: string;
    schemaCheckID: string;
    isLintingEnabled: boolean;
    schemaCheckSubgraphId: string;
  }) {
    let lintIssues: SchemaLintIssues = { warnings: [], errors: [] };
    if (isLintingEnabled && newSchemaSDL !== '') {
      const schemaLinter = new SchemaLinter();
      const lintConfigs = await this.getNamespaceLintConfig(namespaceId);
      if (lintConfigs.length > 0) {
        lintIssues = await schemaLinter.schemaLintCheck({
          schema: newSchemaSDL,
          rulesInput: lintConfigs,
        });
      }
    }

    await this.addSchemaCheckLintIssues({
      schemaCheckId: schemaCheckID,
      lintIssues: [...lintIssues.warnings, ...lintIssues.errors],
      schemaCheckSubgraphId,
    });

    return lintIssues;
  }
}
