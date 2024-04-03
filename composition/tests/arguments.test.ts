import {
  duplicateArgumentsError,
  federateSubgraphs,
  incompatibleArgumentTypesError,
  incompatibleInputValueDefaultValuesError,
  incompatibleInputValueDefaultValueTypeError,
  invalidArgumentsError,
  InvalidRequiredInputValueData,
  invalidRequiredInputValueError,
  normalizeSubgraphFromString,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneSchemaQueryAndPersistedDirectiveDefinitions,
  versionTwoSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';
import { FIELD } from '../src/utils/string-constants';

describe('Argument federation tests', () => {
  const argumentName = 'input';
  const prefix = 'argument "input"';
  const argumentPath = 'Object.field(input: ...)';

  test('that equal arguments merge', () => {
    const { errors, federationResult } = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'String'),
      subgraphWithArgument('subgraph-b', 'String'),
    ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'Float!'),
      subgraphWithArgument('subgraph-b', 'Float'),
    ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'Int'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Int', '1337'),
    ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
    const { errors, federationResult } = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'false'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
    const { errors } = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'String'),
      subgraphWithArgument('subgraph-b', 'Float'),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(incompatibleArgumentTypesError(argumentName, argumentPath, 'String', 'Float'));
  });

  test('that if arguments have different string-converted default values, an error is returned`', () => {
    const expectedType = '1';
    const actualType = '2';
    const { errors } = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Int', expectedType),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Int', actualType),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      incompatibleInputValueDefaultValuesError(prefix, argumentPath, ['subgraph-b'], expectedType, actualType),
    );
  });

  test('that if arguments have different boolean default values, an error is returned`', () => {
    const { errors } = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'true'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      incompatibleInputValueDefaultValuesError(prefix, argumentPath, ['subgraph-b'], 'true', 'false'),
    );
  });

  test('that if arguments have incompatible default values, an error is returned', () => {
    const { errors } = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', '1'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph-a', [
        incompatibleInputValueDefaultValueTypeError(prefix, argumentPath, 'Boolean', '1'),
      ]),
    );
  });

  test('that if an argument is optional but not included in all subgraphs, it is not present in the federated graph', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
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
    const { errors } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
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
    expect(errors![0]).toStrictEqual(invalidRequiredInputValueError(FIELD, 'Interface.field', errorArrayOne));
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
    expect(errors![1]).toStrictEqual(invalidRequiredInputValueError(FIELD, 'Object.field', errorArrayTwo));
  });

  test('that if an argument is not a valid input type or defined more than once, an error is returned', () => {
    const { errors } = normalizeSubgraphFromString(`
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
      
      type AnotherObject {
        a: String!
        b: Int!
        c: Float!
      }
      
      type Object {
        field(argOne: Enum!, argTwo: Input!, argThree: AnotherObject! argThree: String!, argOne: Enum!): String!
      }
    `);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
    expect(errors![0]).toStrictEqual(duplicateArgumentsError('Object.field', ['argThree', 'argOne']));
    expect(errors![1]).toStrictEqual(
      invalidArgumentsError('Object.field', [
        {
          argumentName: 'argThree',
          namedType: 'AnotherObject',
          typeName: 'AnotherObject!',
          typeString: 'object',
        },
      ]),
    );
  });

  test('that arguments are accounted for when merging extension and base definitions', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphE, subgraphF]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneSchemaQueryAndPersistedDirectiveDefinitions +
          `
      type Entity implements Interface @tag(name: "subgraph-f") {
        field(
          four: String = null @tag(name: "object"), 
          one: Int = null @tag(name: "extension"), 
          three: String = null @deprecated(reason: "just because"), 
          two: Int = null @tag(name: "object") @tag(name: "extension")
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
    const { errors } = federateSubgraphs([subgraphWithArgument('subgraph', 'String! = null')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('argument "input"', 'Object.field(input: ...)', 'String!', 'null'),
      ]),
    );
  });

  test('that an error is returned if a required argument defines an incompatible default value', () => {
    const { errors } = federateSubgraphs([subgraphWithArgument('subgraph', 'String = 1')]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      subgraphValidationError('subgraph', [
        incompatibleInputValueDefaultValueTypeError('argument "input"', 'Object.field(input: ...)', 'String', '1'),
      ]),
    );
  });

  test('that the @deperecated directive is persisted on arguments in the federated schema #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphG, subgraphH]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(normalizeString(
      versionOneSchemaQueryAndPersistedDirectiveDefinitions + `
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
    `));
  });

  test('that the @deperecated directive is persisted on arguments in the federated schema #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphG]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(normalizeString(
      versionOneSchemaQueryAndPersistedDirectiveDefinitions + `
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
    `));
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
