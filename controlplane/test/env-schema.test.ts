import { describe, expect, test } from 'vitest';
import { envVariables } from '../src/core/env.schema.js';

const { ANALYTICS_MCP_RATE_LIMIT_PER_MINUTE: rateLimit, ANALYTICS_QUERY_ROW_BUDGET: rowBudget } = envVariables.shape;

describe('Analytics MCP environment variables', () => {
  test('default to 120 requests per minute and 200,000,000 rows', () => {
    expect([rateLimit.parse(undefined), rowBudget.parse(undefined)]).toEqual([120, 200_000_000]);
  });

  test('accept positive integers', () => {
    expect([rateLimit.parse('30'), rowBudget.parse('5000000')]).toEqual([30, 5_000_000]);
  });

  test('refuse values that would switch the rate limit or the row budget off', () => {
    const values = ['abc', '', '0', '-5', '1.5'];

    expect(
      values.map((value) => [value, rateLimit.safeParse(value).success, rowBudget.safeParse(value).success]),
    ).toEqual(values.map((value) => [value, false, false]));
  });
});
