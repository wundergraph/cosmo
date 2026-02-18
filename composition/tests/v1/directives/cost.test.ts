import { describe, expect, test } from 'vitest';
import { parse, ROUTER_COMPATIBILITY_VERSION_ONE, Subgraph } from '../../../src';
import { COST_DIRECTIVE, SCHEMA_QUERY_DEFINITION } from '../utils/utils';
import {
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

const NORMALIZATION_SCHEMA_QUERY = `
  schema {
    query: Query
  }
`;

describe('@cost directive tests', () => {
  describe('normalization tests', () => {
    test('that @cost is correctly normalized on a field definition', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithCostOnField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              expensiveField: String! @cost(weight: 10)
            }
          `,
        ),
      );
    });

    test('that @cost is correctly normalized on an argument definition', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithCostOnArgument, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              search(query: String! @cost(weight: 5)): [Result!]!
            }

            type Result {
              id: ID!
            }
          `,
        ),
      );
    });

    test('that @cost is correctly normalized on an object type', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithCostOnObject, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              user: User!
            }

            type User @cost(weight: 100) {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    test('that @cost is correctly normalized on a scalar', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithCostOnScalar, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            scalar JSON @cost(weight: 50)

            type Query {
              data: JSON!
            }
          `,
        ),
      );
    });

    test('that @cost is correctly normalized on an enum', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithCostOnEnum, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              status: Status!
            }

            enum Status @cost(weight: 1) {
              ACTIVE
              INACTIVE
            }
          `,
        ),
      );
    });

    test('that @cost is correctly normalized on an input field definition', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithCostOnInputField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              search(input: SearchInput!): [Result!]!
            }

            type Result {
              id: ID!
            }

            input SearchInput {
              query: String! @cost(weight: 5)
            }
          `,
        ),
      );
    });

    test('that @cost with negative weight value is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithNegativeCost, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              optimizedField(useCache: Boolean!): String! @cost(weight: -5)
            }
          `,
        ),
      );
    });

    test('that multiple @cost directives on different fields are correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithMultipleCosts, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              cheap: String! @cost(weight: 1)
              expensive: String! @cost(weight: 100)
              medium: String! @cost(weight: 10)
            }
          `,
        ),
      );
    });
  });

  describe('federation tests', () => {
    test('that @cost on fields is stripped from federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnField],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              expensiveField: String!
            }
          `,
        ),
      );
    });

    test('that @cost on object types is stripped from federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnObject],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              user: User!
            }

            type User {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    test('that @cost on scalars is stripped from federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnScalar],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            scalar JSON

            type Query {
              data: JSON!
            }
          `,
        ),
      );
    });

    test('that @cost on enums is stripped from federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnEnum],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              status: Status!
            }

            enum Status {
              ACTIVE
              INACTIVE
            }
          `,
        ),
      );
    });

    test('that @cost on fields is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnField],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              expensiveField: String!
            }
          `,
        ),
      );
    });

    test('that @cost on object types is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnObject],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              user: User!
            }

            type User {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    test('that @cost on scalars is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnScalar],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            scalar JSON

            type Query {
              data: JSON!
            }
          `,
        ),
      );
    });

    test('that @cost on enums is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnEnum],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              status: Status!
            }

            enum Status {
              ACTIVE
              INACTIVE
            }
          `,
        ),
      );
    });

    test('that @cost on arguments is not included in the client schema', () => {
      const { federatedGraphClientSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnArgument],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            `
            type Query {
              search(query: String!): [Result!]!
            }

            type Result {
              id: ID!
            }
          `,
        ),
      );
    });
  });

  describe('validation tests', () => {
    test('that @cost with string weight produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithStringCostWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Int!');
    });

    test('that @cost with decimal weight produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithDecimalCost, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Int!');
    });

    test('that @cost on interface type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostOnInterface, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('invalid location') || e.message.includes('INTERFACE'))).toBe(true);
    });

    test('that @cost on union type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostOnUnion, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('invalid location') || e.message.includes('UNION'))).toBe(true);
    });

    test('that @cost on input object type produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostOnInputObject, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes('invalid location') || e.message.includes('INPUT_OBJECT'))).toBe(true);
    });
  });

  describe('directive argument cost tests', () => {
    test('that @cost on a custom directive argument is extracted into costs.directiveArgumentWeights', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnDirectiveArgument, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.directiveArgumentWeights).toBeDefined();
      expect(costs.directiveArgumentWeights!['myDirective.arg1']).toBe(5);
    });

    test('that @cost on multiple directive arguments is extracted correctly', () => {
      const { costs } = normalizeSubgraphSuccess(
        subgraphWithCostOnMultipleDirectiveArguments,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(costs.directiveArgumentWeights).toBeDefined();
      expect(costs.directiveArgumentWeights!['myDirective.arg1']).toBe(3);
      expect(costs.directiveArgumentWeights!['myDirective.arg2']).toBe(7);
    });

    test('that costs without directive argument weights has undefined directiveArgumentWeights', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.directiveArgumentWeights).toBeUndefined();
    });
  });

  describe('directive definition compliance tests', () => {
    test('that @cost without weight argument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostNoWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('required argument');
    });
  });

  describe('costs internal structure tests', () => {
    test('that @cost on a field populates fieldWeights correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.fieldWeights.get('Query.expensiveField')).toEqual({
        typeName: 'Query', fieldName: 'expensiveField', weight: 10,
      });
    });

    test('that @cost on a field argument populates fieldWeights.argumentWeights', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnArgument, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.fieldWeights.get('Query.search')).toEqual({
        typeName: 'Query', fieldName: 'search', argumentWeights: { query: 5 },
      });
    });

    test('that @cost on an input field populates fieldWeights correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnInputField, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.fieldWeights.get('SearchInput.query')).toEqual({
        typeName: 'SearchInput', fieldName: 'query', weight: 5,
      });
    });

    test('that @cost on an object type populates typeWeights', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnObject, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.typeWeights['User']).toBe(100);
    });

    test('that @cost on a scalar populates typeWeights', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnScalar, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.typeWeights['JSON']).toBe(50);
    });

    test('that @cost on an enum populates typeWeights', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnEnum, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.typeWeights['Status']).toBe(1);
    });

    test('that @cost with negative weight populates fieldWeights correctly', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithNegativeCost, ROUTER_COMPATIBILITY_VERSION_ONE);
      const fw = costs.fieldWeights.get('Query.optimizedField');
      expect(fw).toBeDefined();
      expect(fw!.weight).toBe(-5);
    });

    test('that @cost on multiple fields populates fieldWeights for each', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithMultipleCosts, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.fieldWeights.size).toBe(3);
      expect(costs.fieldWeights.get('Query.cheap')?.weight).toBe(1);
      expect(costs.fieldWeights.get('Query.medium')?.weight).toBe(10);
      expect(costs.fieldWeights.get('Query.expensive')?.weight).toBe(100);
    });

    test('that @cost on both a field and its argument populates a single FieldWeightConfiguration', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithCostOnFieldAndArgument, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.fieldWeights.get('Query.search')).toEqual({
        typeName: 'Query', fieldName: 'search', weight: 10, argumentWeights: { query: 3 },
      });
    });

    test('that a subgraph without cost directives has empty costs', () => {
      const { costs } = normalizeSubgraphSuccess(subgraphWithNoCostDirectives, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(costs.fieldWeights.size).toBe(0);
      expect(costs.listSizes.size).toBe(0);
      expect(Object.keys(costs.typeWeights).length).toBe(0);
      expect(costs.directiveArgumentWeights).toBeUndefined();
    });
  });
});

const subgraphWithCostOnField: Subgraph = {
  name: 'subgraph-cost-field',
  url: '',
  definitions: parse(`
    type Query {
      expensiveField: String! @cost(weight: 10)
    }
  `),
};

const subgraphWithCostOnArgument: Subgraph = {
  name: 'subgraph-cost-argument',
  url: '',
  definitions: parse(`
    type Query {
      search(query: String! @cost(weight: 5)): [Result!]!
    }

    type Result {
      id: ID!
    }
  `),
};

const subgraphWithCostOnObject: Subgraph = {
  name: 'subgraph-cost-object',
  url: '',
  definitions: parse(`
    type Query {
      user: User!
    }

    type User @cost(weight: 100) {
      id: ID!
      name: String!
    }
  `),
};

const subgraphWithCostOnScalar: Subgraph = {
  name: 'subgraph-cost-scalar',
  url: '',
  definitions: parse(`
    type Query {
      data: JSON!
    }

    scalar JSON @cost(weight: 50)
  `),
};

const subgraphWithCostOnEnum: Subgraph = {
  name: 'subgraph-cost-enum',
  url: '',
  definitions: parse(`
    type Query {
      status: Status!
    }

    enum Status @cost(weight: 1) {
      ACTIVE
      INACTIVE
    }
  `),
};

const subgraphWithCostOnInputField: Subgraph = {
  name: 'subgraph-cost-input-field',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Result!]!
    }

    input SearchInput {
      query: String! @cost(weight: 5)
    }

    type Result {
      id: ID!
    }
  `),
};

const subgraphWithDecimalCost: Subgraph = {
  name: 'subgraph-cost-decimal',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost(weight: 2.5)
    }
  `),
};

const subgraphWithNegativeCost: Subgraph = {
  name: 'subgraph-cost-negative',
  url: '',
  definitions: parse(`
    type Query {
      optimizedField(useCache: Boolean!): String! @cost(weight: -5)
    }
  `),
};

const subgraphWithMultipleCosts: Subgraph = {
  name: 'subgraph-cost-multiple',
  url: '',
  definitions: parse(`
    type Query {
      cheap: String! @cost(weight: 1)
      medium: String! @cost(weight: 10)
      expensive: String! @cost(weight: 100)
    }
  `),
};

const subgraphWithStringCostWeight: Subgraph = {
  name: 'subgraph-cost-string-weight',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost(weight: "10")
    }
  `),
};

const subgraphWithCostOnInterface: Subgraph = {
  name: 'subgraph-cost-interface',
  url: '',
  definitions: parse(`
    type Query {
      node: Node!
    }

    interface Node @cost(weight: 10) {
      id: ID!
    }

    type User implements Node {
      id: ID!
      name: String!
    }
  `),
};

const subgraphWithCostOnUnion: Subgraph = {
  name: 'subgraph-cost-union',
  url: '',
  definitions: parse(`
    type Query {
      result: SearchResult!
    }

    union SearchResult @cost(weight: 10) = User | Post

    type User {
      id: ID!
      name: String!
    }

    type Post {
      id: ID!
      title: String!
    }
  `),
};

const subgraphWithCostOnInputObject: Subgraph = {
  name: 'subgraph-cost-input-object',
  url: '',
  definitions: parse(`
    type Query {
      search(input: SearchInput!): [Result!]!
    }

    input SearchInput @cost(weight: 10) {
      query: String!
    }

    type Result {
      id: ID!
    }
  `),
};

const subgraphWithCostNoWeight: Subgraph = {
  name: 'subgraph-cost-no-weight',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost
    }
  `),
};

const subgraphWithCostOnDirectiveArgument: Subgraph = {
  name: 'subgraph-cost-directive-arg',
  url: '',
  definitions: parse(`
    directive @myDirective(arg1: String @cost(weight: 5)) on FIELD_DEFINITION

    type Query {
      field: String! @myDirective(arg1: "hello")
    }
  `),
};

const subgraphWithCostOnMultipleDirectiveArguments: Subgraph = {
  name: 'subgraph-cost-directive-multi-args',
  url: '',
  definitions: parse(`
    directive @myDirective(arg1: String @cost(weight: 3), arg2: Int @cost(weight: 7)) on FIELD_DEFINITION

    type Query {
      field: String! @myDirective(arg1: "hello", arg2: 42)
    }
  `),
};

const subgraphWithCostOnFieldAndArgument: Subgraph = {
  name: 'subgraph-cost-field-and-arg',
  url: '',
  definitions: parse(`
    type Query {
      search(query: String! @cost(weight: 3)): [String!]! @cost(weight: 10)
    }
  `),
};

const subgraphWithNoCostDirectives: Subgraph = {
  name: 'subgraph-no-cost',
  url: '',
  definitions: parse(`
    type Query {
      hello: String!
    }
  `),
};

