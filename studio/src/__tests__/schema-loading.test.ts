import { describe, expect, test } from 'vitest';
import { isSchemaLoading, SchemaLoadingInput, SchemaSdls, selectSchemaSdl } from '../lib/schema-loading';

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

describe('selectSchemaSdl', () => {
  const sdls: SchemaSdls = {
    featureSubgraph: 'type Query { featureSubgraph: String }',
    subgraph: 'type Query { subgraph: String }',
    graph: 'type Query { graph: String }',
  };

  test('that a feature subgraph selection uses the feature subgraph schema', () => {
    expect(selectSchemaSdl('featureSubgraph', sdls)).toBe(sdls.featureSubgraph);
  });

  test('that a subgraph selection uses the subgraph schema', () => {
    expect(selectSchemaSdl('subgraph', sdls)).toBe(sdls.subgraph);
  });

  // A feature flag composes the whole graph, so its schema comes from the federated graph query.
  test.each(['graph', 'featureFlag'] as const)('that a %s selection uses the graph schema', (configType) => {
    expect(selectSchemaSdl(configType, sdls)).toBe(sdls.graph);
  });

  // The endpoint stays the feature subgraph's, so any other schema would have GraphiQL validate
  // operations against something that endpoint does not serve.
  test('that a feature subgraph without a schema does not fall back to the graph schema', () => {
    expect(selectSchemaSdl('featureSubgraph', { ...sdls, featureSubgraph: undefined })).toBeUndefined();
  });
});
