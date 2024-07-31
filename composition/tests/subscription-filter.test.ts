import { describe, expect, test } from 'vitest';
import {
  federateSubgraphs,
  inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidDirectiveError,
  invalidInputFieldTypeErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  invalidSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidSubscriptionFilterDirectiveError,
  invalidSubscriptionFilterLocationError,
  LIST,
  nonLeafSubscriptionFieldConditionFieldPathFinalFieldErrorMessage,
  normalizeSubgraph,
  NULL,
  OBJECT,
  Subgraph,
  subscriptionFieldConditionEmptyValuesArrayErrorMessage,
  subscriptionFieldConditionInvalidInputFieldErrorMessage,
  subscriptionFieldConditionInvalidValuesArrayErrorMessage,
  subscriptionFilterArrayConditionInvalidLengthErrorMessage,
  subscriptionFilterConditionDepthExceededErrorMessage,
  subscriptionFilterConditionInvalidInputFieldErrorMessage,
  subscriptionFilterConditionInvalidInputFieldTypeErrorMessage,
} from '../src';
import { parse } from 'graphql';
import { normalizeString, schemaToSortedNormalizedString } from './utils/utils';
import { CONDITION, FIELD, SUBSCRIPTION } from '../src';

describe('@openfed__subscriptionFilter tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if the directive is defined on a non-subscription root field', () => {
      const { errors } = normalizeSubgraph(subgraphA.definitions);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(invalidSubscriptionFilterLocationError('Object.field'));
    });

    test('that subscriptionFilter inputs and scalar are injected', () => {
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
          values: [openfed__SubscriptionFilterValue]!
        }
        
        input openfed__SubscriptionFilterCondition {
          AND: [openfed__SubscriptionFilterCondition!]
          IN: openfed__SubscriptionFieldCondition
          NOT: openfed__SubscriptionFilterCondition
          OR: [openfed__SubscriptionFilterCondition!]
        }
        
        scalar openfed__SubscriptionFilterValue
      `),
      );
    });

    test('that inputs and scalars that are injected can be self-defined', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphG.definitions);
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
          field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: {IN: {fieldPath: "id", values: [1]}})
        }
        
        scalar openfed__FieldSet

        input openfed__SubscriptionFieldCondition {
          fieldPath: String!
          values: [openfed__SubscriptionFilterValue]!
        }
        
        input openfed__SubscriptionFilterCondition {
          AND: [openfed__SubscriptionFilterCondition!]
          IN: openfed__SubscriptionFieldCondition
          NOT: openfed__SubscriptionFilterCondition
          OR: [openfed__SubscriptionFilterCondition!]
        }
        
        scalar openfed__SubscriptionFilterValue
      `),
      );
    });

    test('that an error is returned if @openfed__subscriptionFilter is repeated', () => {
      const { errors } = normalizeSubgraph(subgraphK.definitions);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidDirectiveError('openfed__subscriptionFilter', 'Subscription.one', [
          invalidRepeatedDirectiveErrorMessage('openfed__subscriptionFilter', 'Subscription.one'),
        ]),
      ]);
    });
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

    test('that an error is returned if condition.IN.fieldPath references a field that is not defined in the same subgraph as the directive', () => {
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

    test('that an error is returned if invalid condition.IN inputs are provided', () => {
      const { errors } = federateSubgraphs([subgraphB, subgraphH]);
      expect(errors).toHaveLength(2);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            ['fieldPath', 'values'],
            [],
            ['field', 'value'],
            [],
          ),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.two', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage('condition.IN', [], ['fieldPath', 'values'], [], []),
        ]),
      ]);
    });

    test('that an error is returned if condition.IN.values is provided an invalid value', () => {
      const { errors } = federateSubgraphs([subgraphB, subgraphI]);
      expect(errors).toHaveLength(4);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            [],
            [],
            [],
            [invalidInputFieldTypeErrorMessage('condition.IN.values', LIST, OBJECT)],
          ),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.two', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            [],
            [],
            [],
            [subscriptionFieldConditionInvalidValuesArrayErrorMessage('condition.IN.values', [0])],
          ),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.three', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            [],
            [],
            [],
            [subscriptionFieldConditionEmptyValuesArrayErrorMessage('condition.IN.values')],
          ),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.four', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            [],
            [],
            [],
            [invalidInputFieldTypeErrorMessage('condition.IN.values', LIST, NULL)],
          ),
        ]),
      ]);
    });

    test('that valid non-list values provided to condition.IN.values will be coerced into a list', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphJ]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'one',
          typeName: 'Subscription',
          subscriptionFilterCondition: {
            in: {
              fieldPath: ['id'],
              values: ['string'],
            },
          },
        },
        {
          argumentNames: [],
          fieldName: 'two',
          typeName: 'Subscription',
          subscriptionFilterCondition: {
            in: {
              fieldPath: ['id'],
              values: [1],
            },
          },
        },
        {
          argumentNames: [],
          fieldName: 'three',
          typeName: 'Subscription',
          subscriptionFilterCondition: {
            in: {
              fieldPath: ['id'],
              values: [3.3],
            },
          },
        },
        {
          argumentNames: [],
          fieldName: 'four',
          typeName: 'Subscription',
          subscriptionFilterCondition: {
            in: {
              fieldPath: ['id'],
              values: [true],
            },
          },
        },
      ]);
    });

    test('that an error is returned if condition input value fields are invalid', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphL]);
      expect(errors).toHaveLength(5);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFilterConditionInvalidInputFieldErrorMessage('condition', 'OUT'),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.two', [
          subscriptionFilterConditionInvalidInputFieldTypeErrorMessage('condition.AND', LIST, OBJECT),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.three', [
          subscriptionFilterConditionInvalidInputFieldTypeErrorMessage('condition.OR', LIST, OBJECT),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.four', [
          subscriptionFilterConditionInvalidInputFieldTypeErrorMessage('condition.IN', OBJECT, LIST),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.five', [
          subscriptionFilterConditionInvalidInputFieldTypeErrorMessage('condition.NOT', OBJECT, LIST),
        ]),
      ]);
    });

    test('that an error is returned if fieldPath references a non-leaf kind', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphM]);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            [],
            [],
            [],
            [
              nonLeafSubscriptionFieldConditionFieldPathFinalFieldErrorMessage(
                'condition.IN.fieldPath',
                'object',
                'object',
                OBJECT,
                'Object',
              ),
            ],
          ),
        ]),
      ]);
    });

    test('that an error is returned if fieldPath references an inaccessible field', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphN]);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFieldConditionInvalidInputFieldErrorMessage(
            'condition.IN',
            [],
            [],
            [],
            [
              inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage(
                'condition.IN.fieldPath',
                'object.id',
                'object.id',
                'Object.id',
              ),
            ],
          ),
        ]),
      ]);
    });

    test('that an error is if condition.AND or condition.OR contain no elements or more than 5 elements', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphO]);
      expect(errors).toHaveLength(4);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFilterArrayConditionInvalidLengthErrorMessage('condition.AND', 6),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.two', [
          subscriptionFilterArrayConditionInvalidLengthErrorMessage('condition.AND', 0),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.three', [
          subscriptionFilterArrayConditionInvalidLengthErrorMessage('condition.OR', 6),
        ]),
        invalidSubscriptionFilterDirectiveError('Subscription.four', [
          subscriptionFilterArrayConditionInvalidLengthErrorMessage('condition.OR', 0),
        ]),
      ]);
    });

    test('that an error is returned if a condition has more than 5 layers of nesting', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphP]);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFilterConditionDepthExceededErrorMessage('condition.NOT.NOT.NOT.NOT.NOT.IN'),
        ]),
      ]);
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
    
    type Entity @key(fields: "id") @key(fields: "id object { name, age } product { sku, continent }") {
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

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: [1] } })
    }
    
    input openfed__SubscriptionFieldCondition {
      fieldPath: String!
      values: [openfed__SubscriptionFilterValue]!
    }
    
    input openfed__SubscriptionFilterCondition {
      AND: [openfed__SubscriptionFilterCondition!]
      IN: openfed__SubscriptionFieldCondition
      NOT: openfed__SubscriptionFilterCondition
      OR: [openfed__SubscriptionFilterCondition!]
    }
    
    scalar openfed__SubscriptionFilterValue
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { field: "id", value: [1], } })
      two: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: [1], fieldPath: "id", values: [1] } })
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: { hello: "world" } } })
      two: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: [{ hello: "world" }] } })
      three: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: [] } })
      four: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: null } })
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: "string" } })
      two: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: 1 } })
      three: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: 3.3 } })
      four: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: true } })
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: "string" } })
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "id", values: "string" } })
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
        @openfed__subscriptionFilter(condition: { OUT: { fieldPath: "id", values: "string" } })
      two: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
        @openfed__subscriptionFilter(condition: { AND: { fieldPath: "id", values: "string" } })
      three: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
        @openfed__subscriptionFilter(condition: { OR: { fieldPath: "id", values: "string" } })
      four: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
        @openfed__subscriptionFilter(condition: { IN: [{ fieldPath: "id", values: "string" }] })
      five: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"])
        @openfed__subscriptionFilter(condition: { NOT: [{ fieldPath: "id", values: "string" }] })
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object! @external
    }
    
    type Object {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "object", values: [1], } })
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object! @external
    }
    
    type Object {
      id: ID! @external @inaccessible
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: { IN: { fieldPath: "object.id", values: [1], } })
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
        condition: { 
          AND: [
            { fieldPath: "id", values: [1], },
            { fieldPath: "id", values: [2], },
            { fieldPath: "id", values: [3], },
            { fieldPath: "id", values: [4], },
            { fieldPath: "id", values: [5], },
            { fieldPath: "id", values: [6], },
          ] 
        }
      )
      two: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
        condition: { 
          AND: [
          ] 
        }
      )
      three: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
        condition: { 
          OR: [
            { fieldPath: "id", values: [1], },
            { fieldPath: "id", values: [2], },
            { fieldPath: "id", values: [3], },
            { fieldPath: "id", values: [4], },
            { fieldPath: "id", values: [5], },
            { fieldPath: "id", values: [6], },
          ] 
        }
      )
      four: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
        condition: { 
          OR: [
          ] 
        }
      )
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    type Subscription {
      one: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(
        condition: { 
          NOT: {
            NOT: {
              NOT: {
                NOT: {
                  NOT: {
                    IN: {
                      fieldPath: "id", values: [1],
                    }
                  }
                }
              }
            }
          }
        }
      )
    }
  `),
};
