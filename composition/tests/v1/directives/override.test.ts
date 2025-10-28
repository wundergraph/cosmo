import { describe, expect, test } from 'vitest';
import {
  ARGUMENT_DEFINITION_UPPER,
  BatchNormalizationSuccess,
  ConfigurationData,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  equivalentSourceAndTargetOverrideErrorMessage,
  FieldData,
  FIRST_ORDINAL,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidFieldShareabilityError,
  invalidOverrideTargetSubgraphNameWarning,
  ObjectDefinitionData,
  OVERRIDE,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  subgraphValidationError,
} from '../../../src';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import { batchNormalize } from '../../../src/v1/normalization/normalization-factory';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('@override directive tests', () => {
  describe('normalization tests', () => {
    test('that an error is returned if the source and target subgraph name for @override are equivalent', () => {
      const { errors } = normalizeSubgraphFailure(subgraphQ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(OVERRIDE, 'Entity.name', FIRST_ORDINAL, [
          equivalentSourceAndTargetOverrideErrorMessage('subgraph-q', 'Entity.name'),
        ]),
      );
    });

    test('that @override produces the correct engine configuration', () => {
      const result = batchNormalize([subgraphA, subgraphE, subgraphF]) as BatchNormalizationSuccess;
      expect(result.success).toBe(true);
      const a = result.internalSubgraphBySubgraphName.get('subgraph-a');
      expect(a).toBeDefined();
      const e = result.internalSubgraphBySubgraphName.get('subgraph-e');
      expect(e).toBeDefined();
      const g = result.internalSubgraphBySubgraphName.get('subgraph-f');
      expect(g).toBeDefined();
      expect(a!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['query']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(e!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(g!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id', 'name', 'age']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id' }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });
  });

  describe('federation tests', () => {
    test('that a warning is returned if @override targets an unknown subgraph name', () => {
      const { federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(warnings).toBeDefined();
      expect(warnings![0]).toStrictEqual(
        invalidOverrideTargetSubgraphNameWarning('subgraph-z', 'Entity', ['age'], 'subgraph-b'),
      );
      expect(warnings![0].subgraph.name).toBe('subgraph-b');
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Entity {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
        ),
      );
    });

    test('that an error is returned if @override is declared on multiple instances of a field', () => {
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphC, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        duplicateOverriddenFieldsError([
          duplicateOverriddenFieldErrorMessage('Entity.name', ['subgraph-c', 'subgraph-d']),
        ]),
      );
    });

    test('that an overridden field does not need to be declared shareable #1.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphA, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #1.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphC, subgraphA],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #2.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #2.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphJ, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #3.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphJ, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
          number: Int!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #3.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphI, subgraphK, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
          number: Int!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #3.3', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphJ, subgraphI, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
          number: Int!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #3.4', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphJ, subgraphK, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
          number: Int!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #3.5', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphK, subgraphI, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
          number: Int!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #3.6', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphK, subgraphJ, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          age: Int!
          id: ID!
          name: String!
          number: Int!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #4.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphL, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
       type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #4.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphM, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
       type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #5.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphN, subgraphO],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
       type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #5.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphO, subgraphN],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
       type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        query: Entity!
      }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #6.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphE, subgraphP],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that an overridden field does not need to be declared shareable #6.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphP, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        type Entity {
          id: ID!
          name: String!
        }
        
        type Query {
          query: Entity!
        }
    `,
        ),
      );
    });

    test('that > 1 instance of an un-shareable field returns an error regardless of override #1', () => {
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphC, subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidFieldShareabilityError(
          {
            fieldDataByName: new Map<string, FieldData>([
              [
                'name',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-c', false],
                    ['subgraph-e', true],
                  ]),
                } as FieldData,
              ],
            ]),
            name: 'Entity',
          } as ObjectDefinitionData,
          new Set<string>(['name']),
        ),
      );
    });

    test('that > 1 instance of an un-shareable field returns an error regardless of override #2', () => {
      const { errors } = federateSubgraphsFailure([subgraphA, subgraphI, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidFieldShareabilityError(
          {
            fieldDataByName: new Map<string, FieldData>([
              [
                'name',
                {
                  isShareableBySubgraphName: new Map<string, boolean>([
                    ['subgraph-a', false],
                    ['subgraph-j', true],
                  ]),
                } as FieldData,
              ],
            ]),
            name: 'Entity',
          } as ObjectDefinitionData,
          new Set<string>(['name']),
        ),
      );
    });

    test('that if @override is declared at an invalid location, an error is returned', () => {
      const { errors } = federateSubgraphsFailure([subgraphG, subgraphH], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      const directiveCoords = 'Entity.name(argOne: ...)';
      expect(errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-g', [
          invalidDirectiveError(OVERRIDE, directiveCoords, FIRST_ORDINAL, [
            invalidDirectiveLocationErrorMessage(OVERRIDE, ARGUMENT_DEFINITION_UPPER),
          ]),
        ]),
      );
    });

    test('that an overridden field still contributes to type merging #1.1', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphR, subgraphS],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Entity {
        id: ID!
        name(argOne: Int!): String
      }
      
      type Query {
        entities: [Entity!]!
      }
    `,
        ),
      );
    });

    test('that an overridden field still contributes to type merging #1.2', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphS, subgraphR],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Entity {
        id: ID!
        name(argOne: Int!): String
      }
      
      type Query {
        entities: [Entity!]!
      }
    `,
        ),
      );
    });

    test('that renamed root type fields are successfully overridden #1.1', () => {
      const { federatedGraphSchema, fieldConfigurations, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
        [subgraphT, subgraphU],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Query {
        fieldOne(argOne: Int!): [String]
        fieldTwo: Int
      }
    `,
        ),
      );
      expect(fieldConfigurations).toStrictEqual([
        {
          argumentNames: ['argOne'],
          fieldName: 'fieldOne',
          typeName: 'Query',
        },
      ]);
      const t = subgraphConfigBySubgraphName.get('subgraph-t');
      expect(t).toBeDefined();
      expect(t!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['fieldOne']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
      const u = subgraphConfigBySubgraphName.get('subgraph-u');
      expect(u).toBeDefined();
      expect(u!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['fieldTwo']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
    });

    test('that renamed root type fields are successfully overridden #1.2', () => {
      const { federatedGraphSchema, fieldConfigurations, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
        [subgraphU, subgraphT],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Query {
        fieldOne(argOne: Int!): [String]
        fieldTwo: Int
      }
    `,
        ),
      );
      expect(fieldConfigurations).toStrictEqual([
        {
          argumentNames: ['argOne'],
          fieldName: 'fieldOne',
          typeName: 'Query',
        },
      ]);
      const t = subgraphConfigBySubgraphName.get('subgraph-t');
      expect(t).toBeDefined();
      expect(t!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['fieldOne']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
      const u = subgraphConfigBySubgraphName.get('subgraph-u');
      expect(u).toBeDefined();
      expect(u!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['fieldTwo']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
    });

    test('that renamed root type fields are successfully overridden #2.1', () => {
      const result = federateSubgraphsSuccess([subgraphV, subgraphW], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Query {
        field: String!
      }
    `,
        ),
      );
      const v = result.subgraphConfigBySubgraphName.get('subgraph-v');
      expect(v).toBeDefined();
      expect(v!.configurationDataByTypeName).toStrictEqual(new Map<string, ConfigurationData>());
      const w = result.subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      expect(w!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['field']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
    });

    test('that renamed root type fields are successfully overridden #2.2', () => {
      const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
        [subgraphW, subgraphV],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
      type Query {
        field: String!
      }
    `,
        ),
      );
      const v = subgraphConfigBySubgraphName.get('subgraph-v');
      expect(v).toBeDefined();
      expect(v!.configurationDataByTypeName).toStrictEqual(new Map<string, ConfigurationData>());
      const w = subgraphConfigBySubgraphName.get('subgraph-w');
      expect(w).toBeDefined();
      expect(w!.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['field']),
              isRootNode: true,
              typeName: 'Query',
            },
          ],
        ]),
      );
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      age: Int! @shareable
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int! @override(from: "subgraph-z") @shareable
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-a")
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-c")
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-a") @shareable
      age: Int! @shareable
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity
    }

    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(argOne: String! @override(from: "subgraph-h")): String!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") @shareable {
      id: ID!
      name(argOne: String!): String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
      age: Int! @shareable
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable @override(from: "subgraph-i")
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @shareable
      number: Int!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
    }

    extend type Entity {
      name: String! @shareable @override(from: "subgraph-m")
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    directive @shareable on FIELD_DEFINITION | OBJECT

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
    }

    extend type Entity {
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-n")
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Query @shareable {
      query: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-e")
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @override(from: "subgraph-q")
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name(argOne: Int): String! @override(from: "subgraph-s")
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name(argOne: Int!): String
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }

    type Queries @shareable {
      fieldOne(argOne: Int!): [String!]! @override(from: "subgraph-u")
      fieldTwo: Int!
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }

    type MyQuery @shareable {
      fieldOne(argOne: Int): [String]
      fieldTwo(argOne: Float): Int  @override(from: "subgraph-t")
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    schema {
      query: RootQueryType
    }

    type RootQueryType {
      field: String!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @override(from: "subgraph-v")
    }
  `),
};
