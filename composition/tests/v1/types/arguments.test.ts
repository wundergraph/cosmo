import {
  BOOLEAN_SCALAR,
  duplicateArgumentsError,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  FIELD,
  FLOAT_SCALAR,
  incompatibleInputValueDefaultValuesError,
  incompatibleInputValueDefaultValueTypeError,
  incompatibleMergedTypesError,
  InputValueData,
  InterfaceDefinitionData,
  invalidNamedTypeError,
  InvalidRequiredInputValueData,
  invalidRequiredInputValueError,
  NormalizationResultFailure,
  normalizeSubgraphFromString,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  STRING_SCALAR,
  Subgraph,
  subgraphValidationError,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import { stringToTypeNode, versionOneRouterDefinitions, versionTwoRouterDefinitions } from '../utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';
import { Kind } from 'graphql';

describe('Argument federation tests', () => {
  const prefix = 'argument "input"';
  const argumentCoords = 'Object.field(input: ...)';

  test('that equal arguments merge', () => {
    const result = federateSubgraphs(
      [subgraphWithArgument('subgraph-a', 'String'), subgraphWithArgument('subgraph-b', 'String')],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
        type Object {
          field(input: String): String
        }
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
    `,
      ),
    );
  });

  test('that arguments merge into their most restrictive form #1', () => {
    const result = federateSubgraphs(
      [subgraphWithArgument('subgraph-a', 'Float!'), subgraphWithArgument('subgraph-b', 'Float')],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object {
        field(input: Float!): String
      }
      
      type Query {
        dummy: String!
      }
  
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that if not all arguments have a default value, the default value is ignored', () => {
    const result = federateSubgraphs(
      [subgraphWithArgument('subgraph-a', 'Int'), subgraphWithArgumentAndDefaultValue('subgraph-b', 'Int', '1337')],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object {
        field(input: Int): String
      }
      
      type Query {
        dummy: String!
      }

      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that if all arguments have the same default value, the default value is included', () => {
    const result = federateSubgraphs(
      [
        subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'false'),
        subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      type Object {
        field(input: Boolean = false): String
      }
      
      type Query {
        dummy: String!
      }

      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that if arguments of the same name are not the same type, an error is returned`', () => {
    const result = federateSubgraphs(
      [subgraphWithArgument('subgraph-a', STRING_SCALAR), subgraphWithArgument('subgraph-b', FLOAT_SCALAR)],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      incompatibleMergedTypesError({
        actualType: FLOAT_SCALAR,
        coords: argumentCoords,
        expectedType: STRING_SCALAR,
        isArgument: true,
      }),
    );
  });

  test('that an error is returned if arguments have different string-converted default values', () => {
    const expectedType = '1';
    const actualType = '2';
    const result = federateSubgraphs(
      [
        subgraphWithArgumentAndDefaultValue('subgraph-a', 'Int', expectedType),
        subgraphWithArgumentAndDefaultValue('subgraph-b', 'Int', actualType),
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      incompatibleInputValueDefaultValuesError(prefix, argumentCoords, ['subgraph-b'], expectedType, actualType),
    );
  });

  test('that if arguments have different boolean default values, an error is returned`', () => {
    const result = federateSubgraphs(
      [
        subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'true'),
        subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      incompatibleInputValueDefaultValuesError(prefix, argumentCoords, ['subgraph-b'], 'true', 'false'),
    );
  });

  test('that if arguments have incompatible default values, an error is returned', () => {
    const result = federateSubgraphs(
      [
        subgraphWithArgumentAndDefaultValue('subgraph-a', BOOLEAN_SCALAR, '1'),
        subgraphWithArgumentAndDefaultValue('subgraph-b', BOOLEAN_SCALAR, 'false'),
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      subgraphValidationError('subgraph-a', [
        incompatibleInputValueDefaultValueTypeError(prefix, argumentCoords, BOOLEAN_SCALAR, '1'),
      ]),
    );
  });

  test('that if an argument is optional but not included in all subgraphs, it is not present in the federated graph', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphB],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoRouterDefinitions +
          `
      interface Interface {
        field(optionalInAll: Boolean, requiredInAll: Int!, requiredOrOptionalInAll: String!): String
      }
    
      type Object implements Interface {
        field(optionalInAll: Boolean, requiredInAll: Int!, requiredOrOptionalInAll: String!): String
      }
      
      type Query {
        dummy: String!
      }
      
      scalar openfed__Scope
    `,
      ),
    );
  });

  test('that if a required argument is not defined in all definitions of a field, an error is returned', () => {
    const result = federateSubgraphs(
      [subgraphA, subgraphC],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    const errorArrayOne: InvalidRequiredInputValueData[] = [
      {
        inputValueName: 'requiredInAll',
        missingSubgraphs: ['subgraph-c'],
        requiredSubgraphs: ['subgraph-a'],
      },
      {
        inputValueName: 'requiredOrOptionalInAll',
        missingSubgraphs: ['subgraph-c'],
        requiredSubgraphs: ['subgraph-a'],
      },
    ];
    expect(result.errors[0]).toStrictEqual(invalidRequiredInputValueError(FIELD, 'Interface.field', errorArrayOne));
    const errorArrayTwo: InvalidRequiredInputValueData[] = [
      {
        inputValueName: 'requiredInAll',
        missingSubgraphs: ['subgraph-c'],
        requiredSubgraphs: ['subgraph-a'],
      },
      {
        inputValueName: 'requiredOrOptionalInAll',
        missingSubgraphs: ['subgraph-c'],
        requiredSubgraphs: ['subgraph-a'],
      },
    ];
    expect(result.errors[1]).toStrictEqual(invalidRequiredInputValueError(FIELD, 'Object.field', errorArrayTwo));
  });

  test('that if an argument is not a valid input type or defined more than once, an error is returned', () => {
    const result = normalizeSubgraphFromString(
      `
      enum Enum {
        A
        B
        C
      }
      
      input Input {
        a: String!
        b: Int!
        c: Float!
      }
      
      interface Interface {
        a: String!
      }
      
      type AnotherObject implements Interface {
        a: String!
        b: Int!
        c: Float!
      }
      
      type Object {
        field(argOne: Enum!, argTwo: Input!, argThree: [Interface!]! argThree: String!, argOne: Enum!): String!
      }
    `,
      true,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as NormalizationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toStrictEqual(duplicateArgumentsError('Object.field', ['argThree', 'argOne']));
    expect(result.errors[1]).toStrictEqual(
      invalidNamedTypeError({
        data: {
          kind: 'InputValueDefinition',
          name: 'argThree',
          originalCoords: 'Object.field(argThree: ...)',
          type: stringToTypeNode('[Interface!]!'),
        } as InputValueData,
        namedTypeData: { name: 'Interface', kind: Kind.INTERFACE_TYPE_DEFINITION } as InterfaceDefinitionData,
        nodeType: `Object field argument`,
      }),
    );
  });

  test('that arguments are accounted for when merging extension and base definitions', () => {
    const result = federateSubgraphs(
      [subgraphD, subgraphE, subgraphF],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity implements Interface @tag(name: "subgraph-f") {
        field(
          four: String = null @tag(name: "object"), 
          one: Int = null @tag(name: "extension"), 
          three: String = null @deprecated(reason: "just because"), 
          two: Int = null @tag(name: "extension") @tag(name: "object")
        ): String
        id: ID!
      }
      
      interface Interface {
        field(four: String = null, one: Int = null, three: String = null, two: Int = null): String
      }
      
      type Query {
        dummy: String!
      }
   `,
      ),
    );
  });

  test('that an error is returned if a required argument uses a null default value', () => {
    const result = federateSubgraphs(
      [subgraphWithArgument('subgraph', 'String! = null')],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('argument "input"', 'Object.field(input: ...)', 'String!', 'null'),
      ]),
    );
  });

  test('that an error is returned if a required argument defines an incompatible default value', () => {
    const result = federateSubgraphs(
      [subgraphWithArgument('subgraph', 'String = 1')],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('argument "input"', 'Object.field(input: ...)', 'String', '1'),
      ]),
    );
  });

  test('that the @deprecated directive is persisted on Arguments in the federated schema #1.1', () => {
    const result = federateSubgraphs(
      [subgraphG, subgraphH],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Entity implements Identifiable {
          field("""one"""one: Int!three: String @deprecated(reason: "Just because")"""two"""two: String): String
          id: Int!
          test: Float!
        }

        interface Identifiable {
          id: Int!
        }
        
        type Query {
          entity: Entity!
        }
    `,
      ),
    );
  });

  test('that the @deprecated directive is persisted on Arguments in the federated schema #1.2', () => {
    const result = federateSubgraphs(
      [subgraphH, subgraphG],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
    expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Entity implements Identifiable {
          field("""one"""one: Int!three: String @deprecated(reason: "Just because")"""two"""two: String): String
          id: Int!
          test: Float!
        }

        interface Identifiable {
          id: Int!
        }
        
        type Query {
          entity: Entity!
        }
    `,
      ),
    );
  });
});

function subgraphWithArgument(name: string, typeName: string): Subgraph {
  return {
    name,
    url: '',
    definitions: parse(`
    type Query {
      dummy: String! @shareable
    }
      
    type Object @shareable {
      field(input: ${typeName}): String
    }
  `),
  };
}

const subgraphWithArgumentAndDefaultValue = (name: string, typeName: string, defaultValue: string): Subgraph => ({
  name,
  url: '',
  definitions: parse(`
    type Query {
      dummy: String! @shareable
    }
    
    type Object @shareable {
      field(input: ${typeName} = ${defaultValue}): String
    }
  `),
});

const subgraphA = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String! @shareable
    }
    
    interface Interface {
      field(requiredInAll: Int!, requiredOrOptionalInAll: String!, optionalInAll: Boolean, optionalInSome: Float): String
    }
    
    type Object implements Interface @shareable {
      field(requiredInAll: Int!, requiredOrOptionalInAll: String!, optionalInAll: Boolean, optionalInSome: Float): String
    }
  `),
};

const subgraphB = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Interface {
      field(requiredInAll: Int!, requiredOrOptionalInAll: String, optionalInAll: Boolean): String
    }
    
    type Object implements Interface @shareable {
      field(requiredInAll: Int!, requiredOrOptionalInAll: String, optionalInAll: Boolean): String
    }
  `),
};

const subgraphC = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    interface Interface {
      field(optionalInAll: Boolean): String
    }
    
    type Object implements Interface @shareable {
      field(optionalInAll: Boolean): String
    }
  `),
};

const subgraphD = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    interface Interface {
      field(one: Int = null, two: Int = null, three: String = null, four: String = null): String
    }
    
    extend type Entity implements Interface @key(fields: "id") {
      id: ID! @external
      field(one: Int = null @tag(name: "extension"), two: Int = null @tag(name: "extension"), three: String = null @deprecated(reason: "just because"), four: String = null): String
    }
  `),
};

const subgraphE = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    interface Interface {
      field(one: Int = null, two: Int = null, three: String = null, four: String = null): String
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      field(one: Int = null, two: Int = null @tag(name: "object"), three: String = null, four: String = null @tag(name: "object")): String
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") @tag(name: "subgraph-f") {
      id: ID!
        field(one: Int = null @tag(name: "extension"), two: Int = null @tag(name: "extension"), three: String = null @deprecated(reason: "just because"), four: String = null): String
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    interface Identifiable {
      id: Int!
    }
    
    type Entity implements Identifiable @key(fields: "id") {
      id: Int!
      field("one" one: Int!, "two" two: String, three: String @deprecated(reason: "Just because")): String
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: Int!
      test: Float!
    }
  `),
};
