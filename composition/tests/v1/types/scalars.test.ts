import { describe, expect, test } from 'vitest';
import {
  federateSubgraphs,
  FederationResultSuccess,
  noBaseScalarDefinitionError,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  ScalarDefinitionData,
  Subgraph,
} from '../../../src';
import { parse } from 'graphql';
import { baseDirectiveDefinitions, versionOneRouterDefinitions } from '../utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';

describe('Scalar tests', () => {
  describe('Normalization tests', () => {
    test('that a Scalar can be extended #1', () => {
      const result = normalizeSubgraph(
        subgraphA.definitions,
        subgraphA.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphB.definitions,
        subgraphB.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
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
      const result = normalizeSubgraph(
        subgraphC.definitions,
        subgraphC.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(noBaseScalarDefinitionError(SCALAR));
    });
  });

  describe('Federation tests', () => {
    test('that a Scalar federates successfully #1.1', () => {
      const result = federateSubgraphs(
        [subgraphD, subgraphE, subgraphF],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphD, subgraphF, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that a Scalar has subgraphs data', () => {
      const result = federateSubgraphs([subgraphA, subgraphB, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);

      expect(result.success).toBe(true);

      if (result.success) {
        const scalarDef = result.parentDefinitionDataByTypeName.get('Scalar') as ScalarDefinitionData;
        expect(scalarDef.subgraphNames.size).toBe(2);
        expect(scalarDef.subgraphNames).toContain(subgraphA.name);
        expect(scalarDef.subgraphNames).toContain(subgraphB.name);
      }
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
