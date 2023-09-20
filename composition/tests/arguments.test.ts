import {
  duplicateArgumentsError,
  federateSubgraphs,
  incompatibleArgumentDefaultValueError,
  incompatibleArgumentDefaultValueTypeError,
  incompatibleArgumentTypesError,
  invalidArgumentsError,
  InvalidRequiredArgument,
  invalidRequiredArgumentsError,
  normalizeSubgraphFromString,
  Subgraph,
} from '../src';
import { Kind, parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  documentNodeToNormalizedString,
  normalizeString,
  versionOnePersistedBaseSchema,
  versionTwoPersistedBaseSchema,
} from './utils/utils';
import { FIELD } from '../src/utils/string-constants';

describe('Argument federation tests', () => {
  const argName = 'input';
  const parentName = 'Object';
  const childName = 'field';

  test('that equal arguments merge', () => {
    const { errors, federationResult } = federateSubgraphs([
      subgraphWithArgument('subgraph-a', 'String'),
      subgraphWithArgument('subgraph-b', 'String'),
    ]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema + `
            type Query {
              dummy: String!
            }

            type Object {
              field(input: String): String
            }
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
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema + `
        type Query {
          dummy: String!
        }
    
        type Object {
          field(input: Float!): String
        }
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
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema + `
        type Query {
          dummy: String!
        }

        type Object {
          field(input: Int): String
        }
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
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(
        versionTwoPersistedBaseSchema + `
        type Query {
          dummy: String!
        }

        type Object {
          field(input: Boolean = false): String
        }
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
    expect(errors![0]).toStrictEqual(
      incompatibleArgumentTypesError(argName, parentName, childName, 'String', 'Float'),
    );
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
      incompatibleArgumentDefaultValueError(argName, parentName, childName, expectedType, actualType),
    );
  });

  test('that if arguments have different boolean default values, an error is returned`', () => {
    const { errors } = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', 'true'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors![0]).toStrictEqual(
      incompatibleArgumentDefaultValueError(argName, parentName, childName, true, false),
    );
  });

  test('that if arguments have incompatible default values, an error is returned', () => {
    const { errors } = federateSubgraphs([
      subgraphWithArgumentAndDefaultValue('subgraph-a', 'Boolean', '1'),
      subgraphWithArgumentAndDefaultValue('subgraph-b', 'Boolean', 'false'),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors![0]).toStrictEqual(
      incompatibleArgumentDefaultValueTypeError(argName, parentName, childName, Kind.INT, Kind.BOOLEAN),
    );
    expect(errors![1]).toStrictEqual(
      incompatibleArgumentDefaultValueError(argName, parentName, childName, '1', false),
    );
  });

  test('that if an argument is optional but not included in all subgraphs, it is not present in the federated graph', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
      normalizeString(versionTwoPersistedBaseSchema + `
      interface Interface {
        field(requiredInAll: Int!, requiredOrOptionalInAll: String!, optionalInAll: Boolean): String
      }
      
      type Query {
        dummy: String!
      }
    
      type Object implements Interface {
        field(requiredInAll: Int!, requiredOrOptionalInAll: String!, optionalInAll: Boolean): String
      }
    `,
      ),
    );
  });

  test('that if a required argument is not defined in all definitions of a field, an error is returned', () => {
    const { errors } = federateSubgraphs([subgraphA, subgraphC]);
    expect(errors).toBeDefined();
    expect(errors).toHaveLength(2);
    const errorArrayOne: InvalidRequiredArgument[] = [{
      argumentName: 'requiredInAll',
      missingSubgraphs: ['subgraph-c'],
      requiredSubgraphs: ['subgraph-a'],
    }, {
      argumentName: 'requiredOrOptionalInAll',
      missingSubgraphs: ['subgraph-c'],
      requiredSubgraphs: ['subgraph-a'],
    }];
    expect(errors![0]).toStrictEqual(invalidRequiredArgumentsError(FIELD, 'Interface.field', errorArrayOne));
    const errorArrayTwo: InvalidRequiredArgument[] = [{
      argumentName: 'requiredInAll',
      missingSubgraphs: ['subgraph-c'],
      requiredSubgraphs: ['subgraph-a'],
    }, {
      argumentName: 'requiredOrOptionalInAll',
      missingSubgraphs: ['subgraph-c'],
      requiredSubgraphs: ['subgraph-a'],
    }];
    expect(errors![1]).toStrictEqual(invalidRequiredArgumentsError(FIELD,'Object.field', errorArrayTwo));
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
    expect(errors![0]).toStrictEqual(duplicateArgumentsError(
      'Object.field',
      ['argThree', 'argOne'],
    ));
    expect(errors![1]).toStrictEqual(invalidArgumentsError(
      'Object.field',
      [{
        argumentName: 'argThree',
        namedType: 'AnotherObject',
        typeName: 'AnotherObject!',
        typeString: 'object',
      }],
    ));
  });

  test('that arguments are accounted for when merging extension and base definitions', () => {
    const { errors, federationResult } = federateSubgraphs([
      subgraphD, subgraphE, subgraphF,
    ]);
    expect(errors).toBeUndefined();
    expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(normalizeString(
      versionOnePersistedBaseSchema + `
      interface Interface {
        field(one: Int = null, two: Int = null, three: String = null, four: String = null): String
      }
      
      type Query {
        dummy: String!
      }
      
      type Entity implements Interface @tag(name: "subgraph-f") {
        id: ID!
        field(
          one: Int = null @tag(name: "extension"), 
          two: Int = null @tag(name: "object") @tag(name: "extension"), 
          three: String = null @deprecated(reason: "just because"), 
          four: String = null @tag(name: "object")
        ): String
      }
   `));
  });
});

const subgraphWithArgument = (name: string, typeName: string): Subgraph => ({
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
});

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

const subgraphF = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") @tag(name: "subgraph-f") {
      id: ID!
        field(one: Int = null @tag(name: "extension"), two: Int = null @tag(name: "extension"), three: String = null @deprecated(reason: "just because"), four: String = null): String
    }
  `),
};