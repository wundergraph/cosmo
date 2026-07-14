import { describe, expect, it } from 'vitest';

import { parse } from 'graphql';

import { applyDeferSuggestions, removeDeferredField, selectOperation } from './defer-advisor-rewrite';

describe('defer advisor rewrites', () => {
  it('can apply individual suggestions sequentially to the same analyzed operation', () => {
    const query = 'query Test { product { name price } }';
    const withName = applyDeferSuggestions(
      query,
      [{ path: 'product', fields: ['name'], label: 'products:product:name' }],
      'Test',
    );
    const withBoth = applyDeferSuggestions(
      withName,
      [{ path: 'product', fields: ['price'], label: 'products:product:price' }],
      'Test',
    );

    expect(withBoth).toContain('@defer(label: "products:product:name")');
    expect(withBoth).toContain('@defer(label: "products:product:price")');
  });

  it('never falls back to a different operation when the selected name is missing', () => {
    const document = parse('query First { product { name } } query Second { product { price } }');

    expect(selectOperation(document, 'Missing')).toBeUndefined();
    expect(selectOperation(document)).toBeUndefined();
  });

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
