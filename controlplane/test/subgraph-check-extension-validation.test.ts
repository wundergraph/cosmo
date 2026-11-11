import { describe, expect, test } from 'vitest';
import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  MAX_CHECK_EXTENSION_FINDINGS,
  subgraphCheckExtensionSchema,
} from '../src/core/webhooks/subgraph-check-extension.js';

describe('check extension response validation', () => {
  test('accepts and trims findings at the limit', () => {
    const issue = {
      lintRuleType: ' custom ',
      severity: LintSeverity.error,
      message: ' Fix this field ',
      issueLocation: { line: 1, column: 2 },
    };
    const parsed = subgraphCheckExtensionSchema.parse({
      errors: ['error'],
      lintIssues: { products: Array.from({ length: MAX_CHECK_EXTENSION_FINDINGS - 1 }, () => issue) },
    });
    expect(parsed.lintIssues?.products).toHaveLength(MAX_CHECK_EXTENSION_FINDINGS - 1);
    expect(parsed.lintIssues?.products[0]).toEqual({ ...issue, lintRuleType: 'custom', message: 'Fix this field' });
    expect(subgraphCheckExtensionSchema.parse({})).toEqual({});
  });

  test.each([
    { errors: Array.from({ length: MAX_CHECK_EXTENSION_FINDINGS + 1 }, () => ({})) },
    { lintIssues: { products: Array.from({ length: MAX_CHECK_EXTENSION_FINDINGS + 1 }, () => ({})) } },
    {
      lintIssues: {
        products: Array.from({ length: 501 }, () => ({})),
        reviews: Array.from({ length: 500 }, () => ({})),
      },
    },
    { lintIssues: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [String(i), []])) },
  ])('rejects oversized collections before validating their elements', (response) => {
    const parsed = subgraphCheckExtensionSchema.safeParse(response);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toHaveLength(1);
    }
  });

  test('still rejects malformed findings below the limit', () => {
    expect(subgraphCheckExtensionSchema.safeParse({ lintIssues: { products: [{}] } }).success).toBe(false);
    expect(subgraphCheckExtensionSchema.safeParse({ errors: [42] }).success).toBe(false);
  });
});
