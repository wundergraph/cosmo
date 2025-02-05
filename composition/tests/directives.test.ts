import {
  federateSubgraphs,
  FIRST_ORDINAL,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  parse,
  Subgraph,
} from '../src';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
  versionTwoDirectiveDefinitions,
} from './utils/utils';

describe('Directive tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if an @inaccessible Enum Value is used as a directive argument', () => {
      const { errors, warnings } = normalizeSubgraph(na.definitions, na.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError('z', 'Query.dummy', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('B', '@z', 'enum', 'Enum!'),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a string can be coerced into a List of String type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(nb.definitions, nb.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if null is provided to a non-nullable List type', () => {
      const { errors, warnings } = normalizeSubgraph(nc.definitions, nc.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError('z', 'Query.dummy', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('null', '@z', 'list', '[[String]!]!'),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a nullable List type can accept null', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(nd.definitions, nd.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that an object can be coerced into a List of Input Object type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(ne.definitions, ne.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that an error is returned if an @inaccessible Enum attempts to coerce into a List type', () => {
      const { errors, warnings } = normalizeSubgraph(nf.definitions, nf.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError('z', 'Query.dummy', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('B', '@z', 'list', '[[Enum!]!]!'),
        ]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that an Enum Value can be coerced into a List of Enum type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(ng.definitions, ng.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that an integer can be coerced into a List of Int type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(nh.definitions, nh.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that a float can be coerced into a List of Int type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(ni.definitions, ni.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that a custom scalar can be coerced into a List of Int type', () => {
      const { errors, normalizationResult, warnings } = normalizeSubgraph(nj.definitions, nj.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      expect(warnings).toHaveLength(0);
    });

    test('that @specifiedBy is supported', () => {
      const { errors } = normalizeSubgraph(subgraphA.definitions, subgraphA.name);
      expect(errors).toBeUndefined();
    });

    test('that directives declared after schema definitions and extensions are still valid #1', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        schema @directiveOne(argOne: "value") {
          query: Queries
        }
        
        type Queries {
          dummy: String!
        }
      
        extend schema @directiveTwo(argOne: "value")
        
        directive @directiveOne(argOne: String!) on SCHEMA
        
        directive @directiveTwo(argOne: String!) on SCHEMA
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        extend schema @directiveOne(argOne: "value")
        
        extend schema @directiveTwo(argOne: "value")
        
        directive @directiveOne(argOne: String!) on SCHEMA
        
        directive @directiveTwo(argOne: String!) on SCHEMA
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
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
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
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
    const { errors, federationResult } = federateSubgraphs([
      { name: 'a', url: '', definitions: parse(`directive @test on OBJECT type Query { dummy: String! }`) },
      { name: 'b', url: '', definitions: parse(`directive @test(a: String!) on OBJECT`) },
    ]);
    expect(errors).toBeUndefined();
  });

  test('that schema directives are supported', () => {
    const { errors } = federateSubgraphs([
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
    ]);
    expect(errors).toBeUndefined();
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
