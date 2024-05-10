import { describe, expect, test } from 'vitest';
import { federateSubgraphs, invalidSubscriptionFilterLocationError, normalizeSubgraph, Subgraph } from '../src';
import { parse } from 'graphql';
import { normalizeString, schemaToSortedNormalizedString } from './utils/utils';
import { FIELD, SUBSCRIPTION } from '../src/utils/string-constants';

describe('@openfed__subscriptionFilter tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if the directive is defined on a non-subscription root field', () => {
      const { errors } = normalizeSubgraph(subgraphA.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidSubscriptionFilterLocationError('Object.field'));
    });

    test('that subscriptionFilter inputs are injected', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphC.definitions);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(`
        schema {
          subscription: Subscription
        }
        
        directive @edfs__kafkaPublish(providerId: String! = "kafka", topics: [String!]!) on FIELD_DEFINITION
        directive @extends on INTERFACE | OBJECT
        directive @external on FIELD_DEFINITION | OBJECT
        directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
        directive @openfed__subscriptionFilter(condition: openfed__SubscriptionFilterCondition!) on FIELD_DEFINITION
        directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
        directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
        directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
        
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }
        
        type Subscription {
          field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: {IN: {fieldPath: "id", values: ["1"]}})
        }
        
        scalar openfed__FieldSet
        
        input openfed__SubscriptionFieldCondition {
          fieldPath: String!
          values: [String!]!
        }
        
        input openfed__SubscriptionFilterCondition {
          AND: [openfed__SubscriptionFilterCondition!]
          IN: openfed__SubscriptionFieldCondition
          NOT: openfed__SubscriptionFilterCondition
          OR: [openfed__SubscriptionFilterCondition!]
        }
      `),
      );
    });

    describe('Federation tests', () => {
      test('that configuration is generated correctly #1', () => {
        const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC]);
        expect(errors).toBeUndefined();
        expect(federationResult).toBeDefined();
        expect(federationResult!.fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: FIELD,
            subscriptionFilterCondition: {
              in: {
                fieldPath: ['id'],
                values: ['1'],
              },
            },
            typeName: SUBSCRIPTION,
          },
        ]);
      });

      test('that configuration is generated correctly #2', () => {
        const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphD]);
        expect(errors).toBeUndefined();
        expect(federationResult).toBeDefined();
        expect(federationResult!.fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: FIELD,
            typeName: SUBSCRIPTION,
            subscriptionFilterCondition: {
              and: [
                {
                  not: {
                    or: [
                      {
                        in: {
                          fieldPath: ['name'],
                          values: ['Jens', 'Stefan'],
                        },
                      },
                      {
                        in: {
                          fieldPath: ['age'],
                          values: ['11', '22'],
                        },
                      },
                    ],
                  },
                },
                {
                  and: [
                    {
                      not: {
                        in: {
                          fieldPath: ['products', 'sku'],
                          values: ['aaa'],
                        },
                      },
                    },
                    {
                      in: {
                        fieldPath: ['products', 'continent'],
                        values: ['NA'],
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]);
      });

      // TODO
      test.skip('that configuration is generated correctly #3', () => {
        const { errors } = normalizeSubgraph(subgraphE.definitions);
        expect(errors).toBeDefined();
      });
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
  
  type Object {
    field: String! @openfed__subscriptionFilter(condition: { IN: { fieldPath: "" } })
  }
  
  type Subscription {
    field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
  }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    enum Contient {
      AS
      AF
      EU
      NA
      OC
      SA
    }
    
    type Entity @key(fields: "id") {
      age: Int!
      id: ID!
      name: String!
      products: [Product!]!
    }
    
    type Product {
      continent: Contient!
      sku: String!
    }
    
    type Query {
      entities: [Entity!]!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: ["1"] } })
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
  
  type Subscription {
    field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
      condition: { AND: [
        { NOT: 
          { OR: [
            { IN: { fieldPath: "name", values: ["Jens", "Stefan"] } },
            { IN: { fieldPath: "age", values: ["11", "22"] } },
          ] },
        },
        { AND: [
          { NOT: 
            { IN: { fieldPath: "products.sku", values: ["aaa"] } },
          },
          { IN: { fieldPath: "products.continent" values: ["NA"] } },
        ] },
      ] }
    )
  }
`),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
  
  type Subscription {
    field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: 1)
  }
`),
};
