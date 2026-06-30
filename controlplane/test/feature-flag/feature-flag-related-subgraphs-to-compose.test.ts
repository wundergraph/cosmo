import { Subgraph } from '@wundergraph/composition';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  FeatureFlagRepository,
  FeatureFlagWithFeatureSubgraphs,
  SubgraphsToCompose,
} from '../../src/core/repositories/FeatureFlagRepository.js';
import { FeatureSubgraphDTO, SubgraphDTO } from '../../src/types/index.js';

// `getFeatureFlagRelatedSubgraphsToCompose` is a pure function over its arguments — it never touches
// `this.db` — so it can be exercised directly with an otherwise-unconstructed repository. This keeps
// these tests fast and free of the Keycloak/Postgres test harness, and isolates the redundant-
// composition skip logic added for ENG-9391.
const repo = new FeatureFlagRepository(undefined as any, undefined as any, 'org-1');

const SDL = `
  type Query {
    hello: String
  }
`;

// Minimal base composition subgraph (only name/url/definitions are read).
const baseCompositionSubgraph = (name: string): Subgraph => ({
  name,
  url: `http://localhost/${name}`,
  definitions: parse(SDL),
});

// Minimal base SubgraphDTO (only `name` is read by the function under test).
const subgraphDTO = (name: string): SubgraphDTO => ({ name }) as unknown as SubgraphDTO;

// Minimal feature subgraph: the function reads name/routingUrl/schemaSDL/baseSubgraphName.
const featureSubgraph = (name: string, baseSubgraphName: string): FeatureSubgraphDTO =>
  ({
    name,
    routingUrl: `http://localhost/${name}`,
    schemaSDL: SDL,
    baseSubgraphName,
  }) as unknown as FeatureSubgraphDTO;

const flag = (id: string, name: string, featureSubgraphs: FeatureSubgraphDTO[]): FeatureFlagWithFeatureSubgraphs => ({
  id,
  name,
  featureSubgraphs,
});

// Topology shared by the cases below. A base composition of two co-resident subgraphs (`users`,
// `products`) plus three flags:
//   - overrides-users:    FS overrides the `users` base subgraph
//   - overrides-products: FS overrides the `products` base subgraph
//   - empty:              has no feature subgraphs (always skipped)
const buildInputs = () => {
  const baseCompositionSubgraphs = [baseCompositionSubgraph('users'), baseCompositionSubgraph('products')];
  const baseSubgraphs = [subgraphDTO('users'), subgraphDTO('products')];

  const flags = new Map<string, FeatureFlagWithFeatureSubgraphs>([
    ['a', flag('a', 'overrides-users', [featureSubgraph('users-fs', 'users')])],
    ['b', flag('b', 'overrides-products', [featureSubgraph('products-fs', 'products')])],
    ['c', flag('c', 'empty', [])],
  ]);

  // The base composition is always seeded first by getSubgraphsToCompose; mirror that here.
  const subgraphsToCompose: SubgraphsToCompose[] = [
    {
      compositionSubgraphs: baseCompositionSubgraphs,
      isFeatureFlagComposition: false,
      subgraphs: baseSubgraphs,
      featureFlagName: '',
      featureFlagId: '',
    },
  ];

  return { baseCompositionSubgraphs, baseSubgraphs, flags, subgraphsToCompose };
};

const flagNames = (result: SubgraphsToCompose[]) =>
  result.filter((s) => s.isFeatureFlagComposition).map((s) => s.featureFlagName);

describe('getFeatureFlagRelatedSubgraphsToCompose', () => {
  test('publish-time (no checkedSubgraphName): composes every flag that has feature subgraphs', () => {
    const { baseCompositionSubgraphs, baseSubgraphs, flags, subgraphsToCompose } = buildInputs();

    const result = repo.getFeatureFlagRelatedSubgraphsToCompose(
      flags,
      baseCompositionSubgraphs,
      baseSubgraphs,
      subgraphsToCompose,
      // checkedSubgraphName omitted → no skipping
    );

    // Base composition is preserved.
    expect(result.filter((s) => !s.isFeatureFlagComposition)).toHaveLength(1);
    // Both non-empty flags compose; the empty flag is skipped.
    expect(flagNames(result).sort()).toEqual(['overrides-products', 'overrides-users']);
  });

  test('base check: skips the flag whose feature subgraph overrides the checked subgraph', () => {
    const { baseCompositionSubgraphs, baseSubgraphs, flags, subgraphsToCompose } = buildInputs();

    const result = repo.getFeatureFlagRelatedSubgraphsToCompose(
      flags,
      baseCompositionSubgraphs,
      baseSubgraphs,
      subgraphsToCompose,
      'users',
    );

    // overrides-users is redundant during a `users` base check (its FS swaps `users` out) → skipped.
    expect(flagNames(result)).not.toContain('overrides-users');
    // overrides-products does NOT override `users`, so `users` still participates → must be recomposed.
    expect(flagNames(result)).toContain('overrides-products');
  });

  test('base check: a flag that overrides a DIFFERENT subgraph is still recomposed (correctness invariant)', () => {
    const { baseCompositionSubgraphs, baseSubgraphs, flags, subgraphsToCompose } = buildInputs();

    // Check the `products` subgraph instead — now the symmetry flips.
    const result = repo.getFeatureFlagRelatedSubgraphsToCompose(
      flags,
      baseCompositionSubgraphs,
      baseSubgraphs,
      subgraphsToCompose,
      'products',
    );

    expect(flagNames(result)).not.toContain('overrides-products');
    expect(flagNames(result)).toContain('overrides-users');
  });

  test('base check: a checked subgraph not overridden by any flag skips nothing', () => {
    const { baseCompositionSubgraphs, baseSubgraphs, flags, subgraphsToCompose } = buildInputs();

    const result = repo.getFeatureFlagRelatedSubgraphsToCompose(
      flags,
      baseCompositionSubgraphs,
      baseSubgraphs,
      subgraphsToCompose,
      'orders', // no flag's feature subgraph overrides this
    );

    expect(flagNames(result).sort()).toEqual(['overrides-products', 'overrides-users']);
  });

  test('flags without feature subgraphs are always skipped, regardless of checkedSubgraphName', () => {
    const baseCompositionSubgraphs = [baseCompositionSubgraph('users')];
    const baseSubgraphs = [subgraphDTO('users')];
    const flags = new Map<string, FeatureFlagWithFeatureSubgraphs>([['c', flag('c', 'empty', [])]]);
    const subgraphsToCompose: SubgraphsToCompose[] = [];

    const result = repo.getFeatureFlagRelatedSubgraphsToCompose(
      flags,
      baseCompositionSubgraphs,
      baseSubgraphs,
      subgraphsToCompose,
      'users',
    );

    expect(result).toHaveLength(0);
  });
});
