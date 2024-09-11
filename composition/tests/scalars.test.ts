import { describe, expect, test } from 'vitest';
import { federateSubgraphs, noBaseScalarDefinitionError, normalizeSubgraph, SCALAR, Subgraph } from '../src';
import { parse } from 'graphql';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
} from './utils/utils';

describe('Scalar tests', () => {
  describe('Normalization tests', () => {
    test('that a Scalar can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphA.definitions, subgraphA.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          scalar Scalar @tag(name: "name")
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that a Scalar can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphB.definitions, subgraphB.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          scalar Scalar @tag(name: "name")
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a subgraph contains a Scalar extension orphan', () => {
      const { errors } = normalizeSubgraph(subgraphC.definitions, subgraphC.name);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseScalarDefinitionError(SCALAR));
    });
  });

  describe('Federation tests', () => {
    test('that a Scalar federates successfully #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE, subgraphF]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          scalar Scalar @tag(name: "name")
        `,
        ),
      );
    });

    test('that a Scalar federates successfully #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphF, subgraphE]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          scalar Scalar @tag(name: "name")
        `,
        ),
      );
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    scalar Scalar
    
    extend scalar Scalar @tag(name: "name")
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    extend scalar Scalar @tag(name: "name")
    
    scalar Scalar
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    extend scalar Scalar @tag(name: "name")
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    scalar Scalar
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    scalar Scalar @tag(name: "name")
  `),
};
