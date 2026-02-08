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
              expensiveField: String! @cost(weight: "10")
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
              search(query: String! @cost(weight: "5")): [Result!]!
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

            type User @cost(weight: "100") {
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
            scalar JSON @cost(weight: "50")

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

            enum Status @cost(weight: "1") {
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
              query: String! @cost(weight: "5")
            }
          `,
        ),
      );
    });

    test('that @cost with decimal weight value is correctly normalized', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphWithDecimalCost, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          NORMALIZATION_SCHEMA_QUERY +
            COST_DIRECTIVE +
            `
            type Query {
              field: String! @cost(weight: "2.5")
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
              optimizedField(useCache: Boolean!): String! @cost(weight: "-5")
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
              cheap: String! @cost(weight: "1")
              expensive: String! @cost(weight: "100")
              medium: String! @cost(weight: "10")
            }
          `,
        ),
      );
    });
  });

  describe('federation tests', () => {
    test('that @cost is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnField],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            type Query {
              expensiveField: String! @cost(weight: "10")
            }
          `,
        ),
      );
    });

    test('that multiple @cost directives on different fields are preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithMultipleCosts],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            type Query {
              cheap: String! @cost(weight: "1")
              expensive: String! @cost(weight: "100")
              medium: String! @cost(weight: "10")
            }
          `,
        ),
      );
    });

    test('that @cost on object types is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnObject],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            type Query {
              user: User!
            }

            type User @cost(weight: "100") {
              id: ID!
              name: String!
            }
          `,
        ),
      );
    });

    test('that @cost on scalars is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnScalar],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            scalar JSON @cost(weight: "50")

            type Query {
              data: JSON!
            }
          `,
        ),
      );
    });

    test('that @cost on enums is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphWithCostOnEnum],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            type Query {
              status: Status!
            }

            enum Status @cost(weight: "1") {
              ACTIVE
              INACTIVE
            }
          `,
        ),
      );
    });

    test('that @cost from multiple subgraphs on different fields is preserved in federated schema', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphACost, subgraphBCost],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            type Query {
              fieldA: String! @cost(weight: "10")
              fieldB: String! @cost(weight: "20")
            }
          `,
        ),
      );
    });

    test('that @cost from multiple subgraphs on the same entity field is deduplicated to first instance', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphACostEntity, subgraphBCostEntity],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            COST_DIRECTIVE +
            `
            type Entity {
              id: ID!
              name: String! @cost(weight: "5")
            }

            type Query {
              entity: Entity!
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
    test('that @cost with non-numeric weight produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithInvalidCostWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a valid numeric string');
    });

    test('that @cost with empty string weight produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithEmptyCostWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a valid numeric string');
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

  describe('directive definition compliance tests', () => {
    test('that @cost without weight argument produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostNoWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('required argument');
    });

    test('that @cost with integer weight (not string) produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostIntegerWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a valid "String!" type');
    });

    test('that @cost with whitespace-only weight produces an error', () => {
      const { errors } = normalizeSubgraphFailure(subgraphWithCostWhitespaceWeight, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('not a valid numeric string');
    });
  });
});

const subgraphWithCostOnField: Subgraph = {
  name: 'subgraph-cost-field',
  url: '',
  definitions: parse(`
    type Query {
      expensiveField: String! @cost(weight: "10")
    }
  `),
};

const subgraphWithCostOnArgument: Subgraph = {
  name: 'subgraph-cost-argument',
  url: '',
  definitions: parse(`
    type Query {
      search(query: String! @cost(weight: "5")): [Result!]!
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

    type User @cost(weight: "100") {
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

    scalar JSON @cost(weight: "50")
  `),
};

const subgraphWithCostOnEnum: Subgraph = {
  name: 'subgraph-cost-enum',
  url: '',
  definitions: parse(`
    type Query {
      status: Status!
    }

    enum Status @cost(weight: "1") {
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
      query: String! @cost(weight: "5")
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
      field: String! @cost(weight: "2.5")
    }
  `),
};

const subgraphWithNegativeCost: Subgraph = {
  name: 'subgraph-cost-negative',
  url: '',
  definitions: parse(`
    type Query {
      optimizedField(useCache: Boolean!): String! @cost(weight: "-5")
    }
  `),
};

const subgraphWithMultipleCosts: Subgraph = {
  name: 'subgraph-cost-multiple',
  url: '',
  definitions: parse(`
    type Query {
      cheap: String! @cost(weight: "1")
      medium: String! @cost(weight: "10")
      expensive: String! @cost(weight: "100")
    }
  `),
};

const subgraphACost: Subgraph = {
  name: 'subgraph-a-cost',
  url: '',
  definitions: parse(`
    type Query {
      fieldA: String! @cost(weight: "10")
    }
  `),
};

const subgraphBCost: Subgraph = {
  name: 'subgraph-b-cost',
  url: '',
  definitions: parse(`
    type Query {
      fieldB: String! @cost(weight: "20")
    }
  `),
};

const subgraphACostEntity: Subgraph = {
  name: 'subgraph-a-cost-entity',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String! @cost(weight: "5")
    }
  `),
};

const subgraphBCostEntity: Subgraph = {
  name: 'subgraph-b-cost-entity',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String! @cost(weight: "10")
    }
  `),
};

const subgraphWithInvalidCostWeight: Subgraph = {
  name: 'subgraph-cost-invalid',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost(weight: "abc")
    }
  `),
};

const subgraphWithEmptyCostWeight: Subgraph = {
  name: 'subgraph-cost-empty',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost(weight: "")
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

    interface Node @cost(weight: "10") {
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

    union SearchResult @cost(weight: "10") = User | Post

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

    input SearchInput @cost(weight: "10") {
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

const subgraphWithCostIntegerWeight: Subgraph = {
  name: 'subgraph-cost-integer-weight',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost(weight: 10)
    }
  `),
};

const subgraphWithCostWhitespaceWeight: Subgraph = {
  name: 'subgraph-cost-whitespace-weight',
  url: '',
  definitions: parse(`
    type Query {
      field: String! @cost(weight: "   ")
    }
  `),
};
