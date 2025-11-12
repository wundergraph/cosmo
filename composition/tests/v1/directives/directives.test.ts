import {
  DirectiveName,
  FIRST_ORDINAL,
  INACCESSIBLE,
  INACCESSIBLE_DEFINITION,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  NormalizationFailure,
  NormalizationSuccess,
  normalizeSubgraph,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  TAG,
  TAG_DEFINITION,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import { INACCESSIBLE_DIRECTIVE, SCHEMA_QUERY_DEFINITION, TAG_DIRECTIVE } from '../utils/utils';
import {
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { DirectiveDefinitionNode } from 'graphql/language';

describe('Directive tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if an @inaccessible Enum Value is used as a directive argument', () => {
      const result = normalizeSubgraph(
        na.definitions,
        na.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError('z', 'Query.dummy', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('B', '@z', 'enum', 'Enum!'),
        ]),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that a string can be coerced into a List of String type', () => {
      const result = normalizeSubgraph(
        nb.definitions,
        nb.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(list: [[String!]!]!) on FIELD_DEFINITION
    
            type Query {
              dummy: String! @z(list: "test")
            }
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that an error is returned if null is provided to a non-nullable List type', () => {
      const result = normalizeSubgraph(
        nc.definitions,
        nc.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError('z', 'Query.dummy', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('null', '@z', 'list', '[[String]!]!'),
        ]),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that a nullable List type can accept null', () => {
      const result = normalizeSubgraph(
        nd.definitions,
        nd.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(list: [[String!]!]) on FIELD_DEFINITION
    
            type Query {
              dummy: String! @z(list: null)
            }
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that an object can be coerced into a List of Input Object type', () => {
      const { schema, warnings } = normalizeSubgraphSuccess(ne, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(list: [[Input!]!]!) on FIELD_DEFINITION
            
            input Input {
              name: String!
            }
            
            type Query {
              dummy: String! @z(list: {name: "String"})
            }
        `,
        ),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if an @inaccessible Enum attempts to coerce into a List type', () => {
      const result = normalizeSubgraph(
        nf.definitions,
        nf.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError('z', 'Query.dummy', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('B', '@z', 'list', '[[Enum!]!]!'),
        ]),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that an Enum Value can be coerced into a List of Enum type', () => {
      const result = normalizeSubgraph(
        ng.definitions,
        ng.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            INACCESSIBLE_DIRECTIVE +
            `
            directive @z(list: [[Enum!]!]!) on FIELD_DEFINITION

            enum Enum {
              A
              B @inaccessible
            }

            type Query {
              dummy: String! @z(list: A)
            }
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that an integer can be coerced into a List of Int type', () => {
      const result = normalizeSubgraph(
        nh.definitions,
        nh.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(list: [[Int!]!]!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(list: 1)
            }
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that a float can be coerced into a List of Int type', () => {
      const result = normalizeSubgraph(
        ni.definitions,
        ni.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(list: [[Float!]!]!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(list: 1.1)
            }
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that a custom scalar can be coerced into a List of Int type', () => {
      const result = normalizeSubgraph(
        nj.definitions,
        nj.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(list: [[Scalar!]!]!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(list: {name: "test"})
            }
            
            scalar Scalar
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that a integer can be coerced into a Float', () => {
      const result = normalizeSubgraph(
        nk.definitions,
        nk.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            directive @z(float: Float!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(float: 1)
            }
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that @specifiedBy is supported', () => {
      const result = normalizeSubgraph(
        subgraphA.definitions,
        subgraphA.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationSuccess;
      expect(result.success).toBe(true);
    });

    test('that directives declared after schema definitions and extensions are still valid #1', () => {
      const { schema } = normalizeSubgraphSuccess(naaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
        schema @directiveOne(argOne: "value") @directiveTwo(argOne: "value") {
          query: Queries
        }
        
        directive @directiveOne(argOne: String!) on SCHEMA
        directive @directiveTwo(argOne: String!) on SCHEMA
        
        type Queries {
          dummy: String!
        }
      `,
        ),
      );
    });

    test('that directives declared after schema definitions and extensions are still valid #2', () => {
      const { schema } = normalizeSubgraphSuccess(nbaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
          extend schema @directiveOne(argOne: "value") @directiveTwo(argOne: "value")
          directive @directiveOne(argOne: String!) on SCHEMA
          directive @directiveTwo(argOne: String!) on SCHEMA`,
        ),
      );
    });

    test('that @deprecated  propagates its default argument if none is provided', () => {
      const { schema } = normalizeSubgraphSuccess(ncaaa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
          type Query {
            a: ID @deprecated(reason: "No longer supported")
          }`,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    test('that @specifiedBy is supported', () => {
      const result = federateSubgraphsSuccess([subgraphA, subgraphB], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
        scalar JSON
        
        type Query {
          field: String!
          json: JSON!
        }
      `,
        ),
      );
    });
  });

  test('that directives compose', () => {
    const result = federateSubgraphsSuccess(
      [
        { name: 'a', url: '', definitions: parse(`directive @test on OBJECT type Query { dummy: String! }`) },
        { name: 'b', url: '', definitions: parse(`directive @test(a: String!) on OBJECT`) },
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(result.success).toBe(true);
  });

  test('that schema directives are supported', () => {
    federateSubgraphsSuccess(
      [
        {
          name: 'test',
          url: '',
          definitions: parse(`
          extend schema @schemaDirective(name: "name", url: "url", description: "description")
          
          directive @schemaDirective(
            "Description for the name argument"
            name: String!
            "Description for the url argument"
            url: String
            "Description for the description argument"
            description: String
          ) on SCHEMA
          
          type Query {
            dummy: String!
          }
      `),
        },
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
  });

  test('that directive definitions are added to federation result', () => {
    const { directiveDefinitionByName, federatedGraphSchema } = federateSubgraphsSuccess(
      [faaaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          INACCESSIBLE_DIRECTIVE +
          TAG_DIRECTIVE +
          `
          type Query {
            a: ID @inaccessible
            b: ID @tag(name: "name")
          }`,
      ),
    );
    expect(directiveDefinitionByName).toStrictEqual(
      new Map<DirectiveName, DirectiveDefinitionNode>([
        [INACCESSIBLE, INACCESSIBLE_DEFINITION],
        [TAG, TAG_DEFINITION],
      ]),
    );
  });
});

const na: Subgraph = {
  name: 'na',
  url: '',
  definitions: parse(`
    directive @z(enum: Enum!) on FIELD_DEFINITION
    
    type Query {
      dummy: String! @z(enum: B)
    }
    
    enum Enum {
      A
      B @inaccessible
    }
  `),
};

const nb: Subgraph = {
  name: 'nb',
  url: '',
  definitions: parse(`
    directive @z(list: [[String!]!]!) on FIELD_DEFINITION
    
    type Query {
      dummy: String! @z(list: "test")
    }
  `),
};

const nc: Subgraph = {
  name: 'nc',
  url: '',
  definitions: parse(`
    directive @z(list: [[String]!]!) on FIELD_DEFINITION
    
    type Query {
      dummy: String! @z(list: null)
    }
  `),
};

const nd: Subgraph = {
  name: 'nd',
  url: '',
  definitions: parse(`
    directive @z(list: [[String!]!]) on FIELD_DEFINITION
    
    type Query {
      dummy: String! @z(list: null)
    }
  `),
};

const ne: Subgraph = {
  name: 'ne',
  url: '',
  definitions: parse(`
    directive @z(list: [[Input!]!]!) on FIELD_DEFINITION
    
    type Query {
      dummy: String! @z(list: { name: "String" })
    }
    
    input Input {
      name: String!
    }
  `),
};

const nf: Subgraph = {
  name: 'nf',
  url: '',
  definitions: parse(`
    directive @z(list: [[Enum!]!]!) on FIELD_DEFINITION

    type Query {
      dummy: String! @z(list: B)
    }

    enum Enum {
      A
      B @inaccessible
    }
  `),
};

const ng: Subgraph = {
  name: 'ng',
  url: '',
  definitions: parse(`
    directive @z(list: [[Enum!]!]!) on FIELD_DEFINITION

    type Query {
      dummy: String! @z(list: A)
    }

    enum Enum {
      A
      B @inaccessible
    }
  `),
};

const nh: Subgraph = {
  name: 'nh',
  url: '',
  definitions: parse(`
    directive @z(list: [[Int!]!]!) on FIELD_DEFINITION

    type Query {
      dummy: String! @z(list: 1)
    }
  `),
};

const ni: Subgraph = {
  name: 'ni',
  url: '',
  definitions: parse(`
    directive @z(list: [[Float!]!]!) on FIELD_DEFINITION

    type Query {
      dummy: String! @z(list: 1.1)
    }
  `),
};

const nj: Subgraph = {
  name: 'nj',
  url: '',
  definitions: parse(`
    directive @z(list: [[Scalar!]!]!) on FIELD_DEFINITION

    type Query {
      dummy: String! @z(list: { name: "test" })
    }
    
    scalar Scalar
  `),
};

const nk: Subgraph = {
  name: 'nk',
  url: '',
  definitions: parse(`
    directive @z(float: Float!) on FIELD_DEFINITION

    type Query {
      dummy: String! @z(float: 1)
    }
  `),
};

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      json: JSON!
    }
    
    scalar JSON @specifiedBy(url: "https://wundergraph.com")
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
  type Query {
    field: String!
  }`),
};

const naaaa: Subgraph = {
  name: 'naaaa',
  url: '',
  definitions: parse(`
    schema @directiveOne(argOne: "value") @directiveTwo(argOne: "value") {
      query: Queries
    }
    
    directive @directiveOne(argOne: String!) on SCHEMA
    directive @directiveTwo(argOne: String!) on SCHEMA
    
    type Queries {
      dummy: String!
    }
  `),
};

const nbaaa: Subgraph = {
  name: 'naaaa',
  url: '',
  definitions: parse(`
    extend schema @directiveOne(argOne: "value")
    
    extend schema @directiveTwo(argOne: "value")
    
    directive @directiveOne(argOne: String!) on SCHEMA
    
    directive @directiveTwo(argOne: String!) on SCHEMA
  `),
};

const ncaaa: Subgraph = {
  name: 'ncaaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @deprecated
    }
  `),
};

const faaaa: Subgraph = {
  name: 'faaaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @inaccessible
      b: ID @tag(name: "name")
    }
  `),
};
