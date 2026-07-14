import { describe, expect, it } from 'vitest';

import { removeDeferredField } from './defer-advisor-rewrite';

describe('defer advisor rewrites', () => {
  it('preserves a user-authored type condition and non-defer directives when undoing', () => {
    const rewritten = removeDeferredField(
      'query Test($show: Boolean!) { product { ... on Product @include(if: $show) @defer(label: "price") { price } } }',
      'product',
      'price',
      'Test',
    );

    expect(rewritten).toContain('... on Product @include(if: $show)');
    expect(rewritten).not.toContain('@defer');
  });
});
