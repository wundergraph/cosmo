import { describe, expect, test } from 'vitest';
import { invalidUnionMemberTypeError, normalizeSubgraph, Subgraph } from '../src';
import { parse } from 'graphql';

describe('Union tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if non-objects are defined as union members', () => {
      const { errors } = normalizeSubgraph(subgraphA.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(
        invalidUnionMemberTypeError('Union', [
          '"Interface", which is type "interface"',
          '"Scalar", which is type "scalar"',
          '"Input", which is type "input object"',
          '"Union", which is type "union"',
        ]),
      );
    });

    test('that an error is returned if non-objects are defined as union members through an extension', () => {
      const { errors } = normalizeSubgraph(subgraphB.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidUnionMemberTypeError('Union', ['"Scalar", which is type "scalar"']));
    });

    test('that an error is returned if non-objects are defined as union members and the union is extended', () => {
      const { errors } = normalizeSubgraph(subgraphC.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidUnionMemberTypeError('Union', ['"Scalar", which is type "scalar"']));
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    interface Interface {
      name: String!
    }
    
    input Input {
      name: String!
    }
    
    scalar Scalar
    
    union Union = Object | Interface | Scalar | Input | Union
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    scalar Scalar
    
    union Union = Object
    
    extend union Union = Scalar
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    scalar Scalar
    
    union Union = Scalar
    
    extend union Union = Object
  `),
};
