import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import * as schema from '../src/db/schema.js';
import { copiedColumns, resolvePolicy, type AnalyticsCopyPolicy } from '../src/core/analytics-copy/policy.js';

describe('Analytics copy policy', () => {
  test('labels every table and column of the schema, and nothing else', () => {
    const schemaColumns: Record<string, string[]> = {};
    for (const value of Object.values(schema)) {
      if (is(value, PgTable)) {
        const config = getTableConfig(value);
        schemaColumns[config.name] = config.columns.map((c) => c.name).sort();
      }
    }

    const policyColumns = Object.fromEntries(
      Object.entries(resolvePolicy()).map(([table, columns]) => [table, Object.keys(columns).sort()]),
    );

    // When this fails after a schema change, label the new column in src/core/analytics-copy/policy.ts.
    expect(policyColumns).toEqual(schemaColumns);
  });

  test('The copy plan lists only the columns labelled copy, by their database names', () => {
    const plan = copiedColumns();
    expect(plan.get('users')).toEqual(['id', 'created_at', 'active', 'updated_at']);
    expect(plan.get('organization_billing')).toContain('stripe_customer_id');
    expect(plan.get('api_keys')).not.toContain('key');
    expect(plan.get('organizations')).not.toContain('invite_code');
    expect(plan.get('schema_check_lint_action')).not.toContain('lint_rule_type');
  });

  test('The copy plan leaves out a table whose columns are all labelled pii, secret or content', () => {
    const policy: AnalyticsCopyPolicy = {
      kept: { id: 'copy', email: 'pii' },
      dropped: { email: 'pii', token: 'secret', sdl: 'content' },
    };
    expect([...copiedColumns(policy).keys()]).toEqual(['kept']);
  });
});
