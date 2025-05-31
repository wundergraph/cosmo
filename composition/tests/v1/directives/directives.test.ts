import {
  federateSubgraphs,
  FederationResultSuccess,
  FIRST_ORDINAL,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  schemaQueryDefinition,
  versionOneRouterDefinitions,
  versionTwoDirectiveDefinitions,
} from '../utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';

describe('Directive tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if an @inaccessible Enum Value is used as a directive argument', () => {
      const result = normalizeSubgraph(
        na.definitions,
        na.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(list: [[String!]!]!) on FIELD_DEFINITION
    
            type Query {
              dummy: String! @z(list: "test")
            }
            
            scalar openfed__FieldSet
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
      ) as NormalizationResultFailure;
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(list: [[String!]!]) on FIELD_DEFINITION
    
            type Query {
              dummy: String! @z(list: null)
            }
            
            scalar openfed__FieldSet
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that an object can be coerced into a List of Input Object type', () => {
      const result = normalizeSubgraph(
        ne.definitions,
        ne.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(list: [[Input!]!]!) on FIELD_DEFINITION
            
            input Input {
              name: String!
            }
            
            type Query {
              dummy: String! @z(list: {name: String})
            }
            
            scalar openfed__FieldSet
        `,
        ),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that an error is returned if an @inaccessible Enum attempts to coerce into a List type', () => {
      const result = normalizeSubgraph(
        nf.definitions,
        nf.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            versionTwoDirectiveDefinitions +
            `
            directive @z(list: [[Enum!]!]!) on FIELD_DEFINITION

            enum Enum {
              A
              B @inaccessible
            }

            type Query {
              dummy: String! @z(list: A)
            }

            scalar openfed__FieldSet
            
            scalar openfed__Scope
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(list: [[Int!]!]!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(list: 1)
            }
            
            scalar openfed__FieldSet
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(list: [[Float!]!]!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(list: 1.1)
            }
            
            scalar openfed__FieldSet
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(list: [[Scalar!]!]!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(list: {name: "test"})
            }
            
            scalar Scalar
            
            scalar openfed__FieldSet
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
            directive @z(float: Float!) on FIELD_DEFINITION
            
            
            type Query {
              dummy: String! @z(float: 1)
            }
            
            scalar openfed__FieldSet
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
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
    });

    test('that directives declared after schema definitions and extensions are still valid #1', () => {
      const result = normalizeSubgraphFromString(
        `
        schema @directiveOne(argOne: "value") {
          query: Queries
        }
        
        type Queries {
          dummy: String!
        }
      
        extend schema @directiveTwo(argOne: "value")
        
        directive @directiveOne(argOne: String!) on SCHEMA
        
        directive @directiveTwo(argOne: String!) on SCHEMA
      `,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          `
        schema @directiveOne(argOne: "value") @directiveTwo(argOne: "value") {
          query: Queries
        }
        
        directive @directiveOne(argOne: String!) on SCHEMA
        directive @directiveTwo(argOne: String!) on SCHEMA` +
            baseDirectiveDefinitions +
            `
        type Queries {
          dummy: String!
        }
        
        scalar openfed__FieldSet
      `,
        ),
      );
    });

    test('that directives declared after schema definitions and extensions are still valid #2', () => {
      const result = normalizeSubgraphFromString(
        `
        extend schema @directiveOne(argOne: "value")
        
        extend schema @directiveTwo(argOne: "value")
        
        directive @directiveOne(argOne: String!) on SCHEMA
        
        directive @directiveTwo(argOne: String!) on SCHEMA
      `,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          `
        directive @directiveOne(argOne: String!) on SCHEMA
        directive @directiveTwo(argOne: String!) on SCHEMA` +
            baseDirectiveDefinitions +
            `scalar openfed__FieldSet`,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    test('that @specifiedBy is supported', () => {
      const result = federateSubgraphs(
        [subgraphA, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
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
    const result = federateSubgraphs(
      [
        { name: 'a', url: '', definitions: parse(`directive @test on OBJECT type Query { dummy: String! }`) },
        { name: 'b', url: '', definitions: parse(`directive @test(a: String!) on OBJECT`) },
      ],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
  });

  test('that schema directives are supported', () => {
    const result = federateSubgraphs(
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
    ) as FederationResultSuccess;
    expect(result.success).toBe(true);
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
      dummy: String! @z(list: { name: String })
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
