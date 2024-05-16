import { describe, expect, test } from 'vitest';
import {
  federateSubgraphs,
  invalidSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidSubscriptionFilterDirectiveError,
  invalidSubscriptionFilterLocationError,
  normalizeSubgraph,
  Subgraph,
  subscriptionFieldConditionInvalidInputFieldErrorMessage,
  subscriptionFilterConditionInvalidInputFieldTypeErrorMessage,
} from '../src';
import { parse } from 'graphql';
import { normalizeString, schemaToSortedNormalizedString } from './utils/utils';
import { CONDITION, FIELD, SUBSCRIPTION } from '../src/utils/string-constants';

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
        
        directive @edfs__kafkaPublish(providerId: String! = "default", topics: [String!]!) on FIELD_DEFINITION
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
                          fieldPath: ['object', 'name'],
                          values: ['Jens', 'Stefan'],
                        },
                      },
                      {
                        in: {
                          fieldPath: ['object', 'age'],
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
                          fieldPath: ['product', 'sku'],
                          values: ['aaa'],
                        },
                      },
                    },
                    {
                      in: {
                        fieldPath: ['product', 'continent'],
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

      test('that an error is returned if an IN condition fieldPath references a field that is not defined in the same subgraph as the directive', () => {
        const { errors } = federateSubgraphs([subgraphB, subgraphF]);
        expect(errors).toBeDefined();
        expect(errors).toHaveLength(1);
        expect(errors![0]).toStrictEqual(
          invalidSubscriptionFilterDirectiveError(`Subscription.field`, [
            subscriptionFieldConditionInvalidInputFieldErrorMessage(
              'condition.AND[0].NOT.OR[0].IN',
              [],
              [],
              [],
              [
                invalidSubscriptionFieldConditionFieldPathFieldErrorMessage(
                  'condition.AND[0].NOT.OR[0].IN.fieldPath',
                  'object.field.name',
                  'object',
                  `Entity.object`,
                  'subgraph-f',
                ),
              ],
            ),
          ]),
        );
      });

      test('that an error is returned if a non-object condition is provided', () => {
        const { errors } = federateSubgraphs([subgraphB, subgraphE]);
        expect(errors).toBeDefined();
        expect(errors).toHaveLength(1);
        expect(errors![0]).toStrictEqual(
          invalidSubscriptionFilterDirectiveError(`Subscription.field`, [
            subscriptionFilterConditionInvalidInputFieldTypeErrorMessage(CONDITION, 'object', 'int'),
          ]),
        );
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
    enum Continent {
      AS
      AF
      EU
      NA
      OC
      SA
    }
    
    type Entity  @key(fields: "id object { name, age } product { sku, continent }") {
      age: Int!
      id: ID!
      name: String!
      object: Object!
      product: Product!
    }
    
    type NestedObject {
      name: String!
    }
    
    type Object @external {
      name: String!
      age: Int!
      field: NestedObject!
    }
  
    type Product {
      continent: Continent!
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
  enum Continent {
    AS
    AF
    EU
    NA
    OC
    SA
  }

  type Entity @key(fields: "id object { name, age } product { sku, continent }", resolvable: false) {
    id: ID! @external
    object: Object! @external
    product: Product! @external
  }
  
  type Object @external {
    name: String!
    age: Int!
  }
  
  type Product @external {
    continent: Continent!
    sku: String!
  }
  
  type Subscription {
    field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
      condition: { AND: [
        { NOT: 
          { OR: [
            { IN: { fieldPath: "object.name", values: ["Jens", "Stefan"] } },
            { IN: { fieldPath: "object.age", values: ["11", "22"] } },
          ] },
        },
        { AND: [
          { NOT: 
            { IN: { fieldPath: "product.sku", values: ["aaa"] } },
          },
          { IN: { fieldPath: "product.continent" values: ["NA"] } },
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

const subgraphF: Subgraph = {
  name: 'subgraph-f',
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
            { IN: { fieldPath: "object.field.name", values: ["Jens", "Stefan"] } },
            { IN: { fieldPath: "object.age", values: ["11", "22"] } },
          ] },
        },
        { AND: [
          { NOT: 
            { IN: { fieldPath: "product.sku", values: ["aaa"] } },
          },
          { IN: { fieldPath: "product.continent" values: ["NA"] } },
        ] },
      ] }
    )
  }
`),
};
