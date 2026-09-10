import { describe, expect, test } from 'vitest';
import { isSchemaLoading, SchemaLoadingInput } from '../lib/schema-loading';

const settled: SchemaLoadingInput = {
  isLoadingGraphSchema: false,
  isLoadingSubgraphSchema: false,
  isLoadingFeatureSubgraphSchema: false,
  isLoadingCompositionFlags: false,
  isFeatureSubgraphSelected: false,
};

describe('isSchemaLoading', () => {
  test('that a feature subgraph selection waits for the feature flag list', () => {
    expect(
      isSchemaLoading({
        ...settled,
        isFeatureSubgraphSelected: true,
        isLoadingCompositionFlags: true,
      }),
    ).toBe(true);
  });

  // A stale bookmark, a renamed flag, or a feature subgraph dropped from the flag leaves the
  // selection unresolvable. Gating on the resolved value rather than the request kept the schema
  // withheld forever.
  test('that an unresolvable feature subgraph stops waiting once the flag list settles', () => {
    expect(isSchemaLoading({ ...settled, isFeatureSubgraphSelected: true })).toBe(false);
  });

  test('that a graph selection does not wait for the feature flag list', () => {
    expect(isSchemaLoading({ ...settled, isLoadingCompositionFlags: true })).toBe(false);
  });
});
