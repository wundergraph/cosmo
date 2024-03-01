import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { LintRuleType, SchemaLintDTO, LintSeverityLevel, LintIssueResult } from 'src/types/index.js';
import { LintConfig, LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import * as schema from '../../db/schema.js';
import { namespaceLintCheckConfig, schemaCheckLintAction } from '../../db/schema.js';

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
        ruleName: l.lintRule as LintRuleType,
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

    await this.db.insert(namespaceLintCheckConfig).values(
      lintConfigs.map((l) => {
        return {
          namespaceId,
          lintRule: l.ruleName as LintRuleType,
          severityLevel:
            l.severityLevel === LintSeverity.error ? ('error' as LintSeverityLevel) : ('warn' as LintSeverityLevel),
        };
      }),
    );
  }

  public async addSchemaCheckLintIssues({
    schemaCheckId,
    lintIssues,
  }: {
    schemaCheckId: string;
    lintIssues: LintIssueResult[];
  }) {
    await this.db.insert(schemaCheckLintAction).values(
      lintIssues.map((l) => {
        return {
          schemaCheckId,
          message: l.message,
          location: l.issueLocation,
          isError: l.severity === LintSeverity.error,
        };
      }),
    );
  }

  public async getSchemaCheckLintIsssues({ schemaCheckId }: { schemaCheckId: string }): Promise<LintIssueResult[]> {
    const lintIssues = await this.db
      .select({
        message: schemaCheckLintAction.message,
        location: schemaCheckLintAction.location,
        isError: schemaCheckLintAction.isError,
      })
      .from(schemaCheckLintAction);

    return lintIssues.map((l) => {
      return {
        ruleId: undefined,
        issueLocation: l.location,
        message: l.message,
        severity: l.isError ? LintSeverity.error : LintSeverity.warn,
      } as LintIssueResult;
    });
  }
}
