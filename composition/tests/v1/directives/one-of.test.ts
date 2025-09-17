import { describe, expect, test } from 'vitest';
import {
  INPUT,
  oneOfRequiredFieldsError,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  singleFederatedInputFieldOneOfWarning,
  singleSubgraphInputFieldOneOfWarning,
  Subgraph,
} from '../../../src';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { baseDirectiveDefinitions, schemaQueryDefinition, versionOneRouterDefinitions } from '../utils/utils';

describe('@oneOf tests', () => {
  describe('normalization tests', () => {
    test('that an error is returned if an Input field is required', () => {
      const { errors } = normalizeSubgraphFailure(naaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        oneOfRequiredFieldsError({
          requiredFieldNames: ['a'],
          typeName: INPUT,
        }),
      );
    });

    test('that an error is returned if multiple Input fields are required', () => {
      const { errors } = normalizeSubgraphFailure(nbaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        oneOfRequiredFieldsError({
          requiredFieldNames: ['a', 'b', 'c'],
          typeName: INPUT,
        }),
      );
    });

    test('that an error is returned if an extension Input field is required', () => {
      const { errors } = normalizeSubgraphFailure(ncaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        oneOfRequiredFieldsError({
          requiredFieldNames: ['c'],
          typeName: INPUT,
        }),
      );
    });

    test('that @oneOf is validated successfully', () => {
      const { schema } = normalizeSubgraphSuccess(ndaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
        input Input @oneOf {
          a: ID
          b: String
          c: NestedInput
          d: Int
        }
        
        input NestedInput {
          a: Float
        }
        
        scalar openfed__FieldSet
      `,
        ),
      );
    });

    test('that a single Input field with @oneOf produces a warning', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(neaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
        input Input @oneOf {
          a: ID
        }
        
        scalar openfed__FieldSet
      `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toStrictEqual(
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: neaa.name,
          typeName: INPUT,
        }),
      );
    });
  });

  describe('federation tests', () => {
    test('that the directive is persisted in the federated schemas #1', () => {
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [faaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings).toStrictEqual([
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: faaa.name,
          typeName: INPUT,
        }),
        singleFederatedInputFieldOneOfWarning({
          fieldName: 'a',
          typeName: INPUT,
        }),
      ]);
    });

    test('that the directive is persisted in the federated schema #2.1', () => {
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [faaa, faab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(3);
      expect(warnings).toStrictEqual([
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: faaa.name,
          typeName: INPUT,
        }),
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: faab.name,
          typeName: INPUT,
        }),
        singleFederatedInputFieldOneOfWarning({
          fieldName: 'a',
          typeName: INPUT,
        }),
      ]);
    });

    test('that the directive is persisted in the federated schema #2.2', () => {
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [faab, faaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(3);
      expect(warnings).toStrictEqual([
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: faab.name,
          typeName: INPUT,
        }),
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: faaa.name,
          typeName: INPUT,
        }),
        singleFederatedInputFieldOneOfWarning({
          fieldName: 'a',
          typeName: INPUT,
        }),
      ]);
    });

    test('that the directive is persisted in the federated schema #3', () => {
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [faac, faaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input @oneOf {
              a: ID
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings).toStrictEqual([
        singleSubgraphInputFieldOneOfWarning({
          fieldName: 'a',
          subgraphName: faaa.name,
          typeName: INPUT,
        }),
        singleFederatedInputFieldOneOfWarning({
          fieldName: 'a',
          typeName: INPUT,
        }),
      ]);
    });

    test('that the directive is persisted in the federated schema #4', () => {
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [faad, faae, faaf],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @oneOf {
              c: Int
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input @oneOf {
              c: Int
            }
            
            type Query {
              a(a: Input!): ID!
            }
          `,
        ),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings).toStrictEqual([
        singleFederatedInputFieldOneOfWarning({
          fieldName: 'c',
          typeName: INPUT,
        }),
      ]);
    });

    test('that an error is returned if another subgraph requires an Input field #1', () => {
      const { errors } = federateSubgraphsFailure([fbaa, fbab], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        oneOfRequiredFieldsError({
          requiredFieldNames: ['b'],
          typeName: INPUT,
        }),
      );
    });

    test('that an error is returned if another subgraph requires an Input field #2', () => {
      const { errors } = federateSubgraphsFailure([fbaa, fbab, fbac], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        oneOfRequiredFieldsError({
          requiredFieldNames: ['a', 'b'],
          typeName: INPUT,
        }),
      );
    });
  });
});

const naaa: Subgraph = {
  name: 'naaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID!
    }
  `),
};

const nbaa: Subgraph = {
  name: 'nbaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID!
      b: String!
      c: NestedInput!
    }
    
    input NestedInput {
      a: ID
    }
  `),
};

const ncaa: Subgraph = {
  name: 'ncaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
      b: String
    }
    
    extend input Input {
      c: NestedInput!
    }
    
    input NestedInput {
      a: ID
    }
  `),
};

const ndaa: Subgraph = {
  name: 'ndaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
      b: String
    }
    
    extend input Input {
      c: NestedInput
    }
    
    extend input Input {
      d: Int
    }
    
    input NestedInput {
      a: Float
    }
  `),
};

const neaa: Subgraph = {
  name: 'neaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
    }
  `),
};

const faaa: Subgraph = {
  name: 'faaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
    }
    
    type Query {
      a(a: Input!): ID!
    }
  `),
};

const faab: Subgraph = {
  name: 'faab',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
    }
  `),
};

const faac: Subgraph = {
  name: 'faac',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
      b: String
    }
  `),
};

const faad: Subgraph = {
  name: 'faad',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
      b: String
      c: Int
    }
    
    type Query {
      a(a: Input!): ID!
    }
  `),
};

const faae: Subgraph = {
  name: 'faae',
  url: '',
  definitions: parse(`
    input Input {
      a: ID
      c: Int
    }
  `),
};

const faaf: Subgraph = {
  name: 'faaf',
  url: '',
  definitions: parse(`
    input Input {
      b: String
      c: Int
    }
  `),
};

const fbaa: Subgraph = {
  name: 'fbaa',
  url: '',
  definitions: parse(`
    input Input @oneOf {
      a: ID
      b: Boolean
    }
    
    type Query {
      a(a: Input!): ID!
    }
  `),
};

const fbab: Subgraph = {
  name: 'fbab',
  url: '',
  definitions: parse(`
    input Input {
      a: ID
      b: Boolean!
    }
  `),
};

const fbac: Subgraph = {
  name: 'fbac',
  url: '',
  definitions: parse(`
    input Input {
      a: ID!
      b: Boolean
    }
`),
};
