import { describe, expect, test } from 'vitest';
import { usesDirective } from '../src/lib/utils';

describe('usesDirective', () => {
  test('finds a directive on a field', () => {
    expect(usesDirective('defer', 'query { ... @defer { hello } }')).toBe(true);
  });

  test('ignores a mention in a comment', () => {
    expect(usesDirective('defer', '# this query has no @defer\nquery { hello }')).toBe(false);
  });

  test('returns false for text that does not parse', () => {
    expect(usesDirective('defer', 'query { ... @defer {')).toBe(false);
  });
});
