import { describe, expect, test } from 'vitest';
import {
  noBaseScalarDefinitionError,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  ScalarDefinitionData,
  Subgraph,
} from '../../../src';
import { parse } from 'graphql';
import { SCHEMA_QUERY_DEFINITION, TAG_DIRECTIVE } from '../utils/utils';
import {
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('Scalar tests', () => {
  describe('Normalization tests', () => {
    test('that a Scalar can be extended #1', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          scalar Scalar @tag(name: "name")
        `,
        ),
      );
    });

    test('that a Scalar can be extended #2', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphB, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          TAG_DIRECTIVE +
            `
          scalar Scalar @tag(name: "name")
        `,
        ),
      );
    });

    test('that an error is returned if a subgraph contains a Scalar extension orphan', () => {
      const { errors } = normalizeSubgraphFailure(subgraphC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(noBaseScalarDefinitionError(SCALAR));
    });
  });

  describe('Federation tests', () => {
    test('that a Scalar federates successfully #1.1', () => {
      const result = federateSubgraphsSuccess([subgraphD, subgraphE, subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            TAG_DIRECTIVE +
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
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphD, subgraphF, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            TAG_DIRECTIVE +
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
      const { parentDefinitionDataByTypeName } = federateSubgraphsSuccess(
        [subgraphA, subgraphB, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      const scalarDef = parentDefinitionDataByTypeName.get('Scalar') as ScalarDefinitionData;
      expect(scalarDef.subgraphNames.size).toBe(2);
      expect(scalarDef.subgraphNames).toContain(subgraphA.name);
      expect(scalarDef.subgraphNames).toContain(subgraphB.name);
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
