import { describe, expect, test } from 'vitest';
import {
  CONDITION,
  FIRST_ORDINAL,
  inaccessibleSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  invalidEventDrivenGraphError,
  invalidInputFieldTypeErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  invalidSubscriptionFieldConditionFieldPathFieldErrorMessage,
  invalidSubscriptionFilterDirectiveError,
  invalidSubscriptionFilterLocationError,
  LIST,
  nonKeyComposingObjectTypeNamesEventDrivenErrorMessage,
  nonLeafSubscriptionFieldConditionFieldPathFinalFieldErrorMessage,
  type NormalizationSuccess,
  NULL,
  OBJECT,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
  subgraphValidationError,
  SUBSCRIPTION,
  SUBSCRIPTION_FILTER,
  subscriptionFieldConditionEmptyValuesArrayErrorMessage,
  subscriptionFieldConditionInvalidInputFieldErrorMessage,
  subscriptionFieldConditionInvalidValuesArrayErrorMessage,
  subscriptionFilterArrayConditionInvalidLengthErrorMessage,
  subscriptionFilterConditionDepthExceededErrorMessage,
  subscriptionFilterConditionInvalidInputFieldErrorMessage,
  subscriptionFilterConditionInvalidInputFieldTypeErrorMessage,
  subscriptionFilterInterfaceImplementerInvalidErrorMessage,
  subscriptionFilterUnionMemberInvalidErrorMessage,
  undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage,
} from '../../../src';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  OPENFED_FIELD_SET,
  OPENFED_SUBSCRIPTION_FIELD_CONDITION,
  OPENFED_SUBSCRIPTION_FILTER_CONDITION,
  OPENFED_SUBSCRIPTION_FILTER_VALUE,
} from '../utils/utils';

describe('@openfed__subscriptionFilter tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if the directive is defined on a non-subscription root field', () => {
      const { errors } = normalizeSubgraphFailure(subgraphA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toStrictEqual(invalidSubscriptionFilterLocationError('Object.field'));
      expect(errors[1]).toStrictEqual(
        invalidEventDrivenGraphError([nonKeyComposingObjectTypeNamesEventDrivenErrorMessage([OBJECT])]),
      );
    });

    test('that subscriptionFilter inputs and scalar are injected', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
        schema {
          subscription: Subscription
        }
        
        directive @edfs__kafkaSubscribe(providerId: String! = "default", topics: [String!]!) on FIELD_DEFINITION
        directive @external on FIELD_DEFINITION | OBJECT
        directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
        directive @openfed__subscriptionFilter(condition: openfed__SubscriptionFilterCondition!) on FIELD_DEFINITION

        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }
        
        type Subscription {
          field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: {IN: {fieldPath: "id", values: ["1"]}})
        }
      ` +
            OPENFED_FIELD_SET +
            OPENFED_SUBSCRIPTION_FIELD_CONDITION +
            OPENFED_SUBSCRIPTION_FILTER_CONDITION +
            OPENFED_SUBSCRIPTION_FILTER_VALUE,
        ),
      );
    });

    test('that inputs and scalars that are injected can be self-defined', () => {
      const { schema } = normalizeSubgraphSuccess(subgraphG, ROUTER_COMPATIBILITY_VERSION_ONE) as NormalizationSuccess;
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          `
        schema {
          subscription: Subscription
        }
        
        directive @edfs__kafkaSubscribe(providerId: String! = "default", topics: [String!]!) on FIELD_DEFINITION
        directive @external on FIELD_DEFINITION | OBJECT
        directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
        directive @openfed__subscriptionFilter(condition: openfed__SubscriptionFilterCondition!) on FIELD_DEFINITION

        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }
        
        type Subscription {
          field: Entity! @edfs__kafkaSubscribe(topics: ["employeeUpdated"]) @openfed__subscriptionFilter(condition: {IN: {fieldPath: "id", values: [1]}})
        }
      ` +
            OPENFED_FIELD_SET +
            OPENFED_SUBSCRIPTION_FIELD_CONDITION +
            OPENFED_SUBSCRIPTION_FILTER_CONDITION +
            OPENFED_SUBSCRIPTION_FILTER_VALUE,
        ),
      );
    });

    test('that an error is returned if @openfed__subscriptionFilter is repeated', () => {
      const { errors } = normalizeSubgraphFailure(subgraphK, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors).toStrictEqual([
        invalidDirectiveError('openfed__subscriptionFilter', 'Subscription.one', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage('openfed__subscriptionFilter'),
        ]),
      ]);
    });
  });

  describe('Federation tests', () => {
    test('that configuration is generated correctly #1', () => {
      const result = federateSubgraphsSuccess([subgraphB, subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'field',
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
      const result = federateSubgraphsSuccess([subgraphB, subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'field',
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
      const result = federateSubgraphsFailure([subgraphB, subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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
      const result = federateSubgraphsFailure([subgraphB, subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError(subgraphE.name, [
          invalidDirectiveError(SUBSCRIPTION_FILTER, `Subscription.field`, FIRST_ORDINAL, [
            invalidArgumentValueErrorMessage(
              '1',
              `@${SUBSCRIPTION_FILTER}`,
              CONDITION,
              'openfed__SubscriptionFilterCondition!',
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if invalid condition.IN inputs are provided', () => {
      const result = federateSubgraphsFailure([subgraphB, subgraphH], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toStrictEqual([
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
      const result = federateSubgraphsFailure([subgraphB, subgraphI], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(4);
      expect(result.errors).toStrictEqual([
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
      const result = federateSubgraphsSuccess([subgraphB, subgraphJ], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(true);
      expect(result.fieldConfigurations).toStrictEqual([
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
      const result = federateSubgraphsFailure([subgraphB, subgraphL], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(5);
      expect(result.errors).toStrictEqual([
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
      const result = federateSubgraphsFailure([subgraphB, subgraphM], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors).toStrictEqual([
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
      const result = federateSubgraphsFailure([subgraphB, subgraphN], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors).toStrictEqual([
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
      const result = federateSubgraphsFailure([subgraphB, subgraphO], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(4);
      expect(result.errors).toStrictEqual([
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
      const result = federateSubgraphsFailure([subgraphB, subgraphP], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors).toStrictEqual([
        invalidSubscriptionFilterDirectiveError('Subscription.one', [
          subscriptionFilterConditionDepthExceededErrorMessage('condition.NOT.NOT.NOT.NOT.NOT.IN'),
        ]),
      ]);
    });

    test('that a subscription filter is emitted when the return type is a union', () => {
      const result = federateSubgraphsSuccess(
        [subgraphUnionResolver, subgraphUnionEDG],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(result.success).toBe(true);
      const subscriptionFields = result.fieldConfigurations.filter(
        (fc) => fc.typeName === SUBSCRIPTION && fc.fieldName === 'onTaskEvent',
      );
      expect(subscriptionFields).toHaveLength(1);
      expect(subscriptionFields[0]).toStrictEqual({
        argumentNames: ['phoneChannelId'],
        fieldName: 'onTaskEvent',
        typeName: SUBSCRIPTION,
        subscriptionFilterCondition: {
          in: {
            fieldPath: ['phoneChannelId'],
            values: ['{{ args.phoneChannelId }}'],
          },
        },
      });
    });

    test('that a subscription filter is emitted when the return type is an interface', () => {
      const result = federateSubgraphsSuccess(
        [subgraphInterfaceResolver, subgraphInterfaceEDG],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(result.success).toBe(true);
      const subscriptionFields = result.fieldConfigurations.filter(
        (fc) => fc.typeName === SUBSCRIPTION && fc.fieldName === 'onTaskEvent',
      );
      expect(subscriptionFields).toHaveLength(1);
      expect(subscriptionFields[0]).toStrictEqual({
        argumentNames: ['phoneChannelId'],
        fieldName: 'onTaskEvent',
        typeName: SUBSCRIPTION,
        subscriptionFilterCondition: {
          in: {
            fieldPath: ['phoneChannelId'],
            values: ['{{ args.phoneChannelId }}'],
          },
        },
      });
    });

    test('that composition fails when a union member is missing the filter fieldPath', () => {
      const result = federateSubgraphsFailure(
        [subgraphUnionResolverPartial, subgraphUnionMemberMissingField],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toStrictEqual(
        invalidSubscriptionFilterDirectiveError(`Subscription.onTaskEvent`, [
          subscriptionFilterUnionMemberInvalidErrorMessage(
            'TaskEvent',
            'TaskDeleted',
            subscriptionFieldConditionInvalidInputFieldErrorMessage(
              'condition.IN',
              [],
              [],
              [],
              [
                undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage(
                  'condition.IN.fieldPath',
                  'phoneChannelId',
                  'phoneChannelId',
                  'phoneChannelId',
                  'TaskDeleted',
                ),
              ],
            ),
          ),
        ]),
      );
    });

    test('that composition fails when an interface implementer is missing the filter fieldPath', () => {
      const result = federateSubgraphsFailure(
        [subgraphInterfaceResolverPartial, subgraphInterfaceImplementerMissingField],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toStrictEqual(
        invalidSubscriptionFilterDirectiveError(`Subscription.onTaskEvent`, [
          subscriptionFilterInterfaceImplementerInvalidErrorMessage(
            'TaskEvent',
            'TaskDeleted',
            subscriptionFieldConditionInvalidInputFieldErrorMessage(
              'condition.IN',
              [],
              [],
              [],
              [
                undefinedSubscriptionFieldConditionFieldPathFieldErrorMessage(
                  'condition.IN.fieldPath',
                  'phoneChannelId',
                  'phoneChannelId',
                  'phoneChannelId',
                  'TaskDeleted',
                ),
              ],
            ),
          ),
        ]),
      );
    });

    test('that composition succeeds when an @inaccessible union member is missing the filter fieldPath', () => {
      const result = federateSubgraphsSuccess(
        [subgraphUnionResolverPartial, subgraphUnionInaccessibleMemberMissingField],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(result.success).toBe(true);
      const subscriptionFields = result.fieldConfigurations.filter(
        (fc) => fc.typeName === SUBSCRIPTION && fc.fieldName === 'onTaskEvent',
      );
      expect(subscriptionFields).toHaveLength(1);
      expect(subscriptionFields[0]).toStrictEqual({
        argumentNames: ['phoneChannelId'],
        fieldName: 'onTaskEvent',
        typeName: SUBSCRIPTION,
        subscriptionFilterCondition: {
          in: {
            fieldPath: ['phoneChannelId'],
            values: ['{{ args.phoneChannelId }}'],
          },
        },
      });
    });

    test('that an entity can be defined as an extension in an EDG', () => {
      const { federatedGraphSchema } = federateSubgraphsSuccess(
        [subgraphQ, subgraphR],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          `schema {
          query: Query
          subscription: Subscription
        }
        
        type Entity {
          id: ID!
          name: String!
        }
        
        type Query {
          entity: Entity!
        }
        
        type Subscription {
          field: Entity!
        }
      `,
        ),
      );
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
    
    type Object {
      id: ID!
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

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id", resolvable: false) {
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

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Query{
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
  `),
};

// Fixtures for union and interface return types

const subgraphUnionResolver: Subgraph = {
  name: 'subgraph-union-resolver',
  url: '',
  definitions: parse(`
    type Query {
      task(id: ID!): TaskUpdated
    }

    type TaskUpdated @key(fields: "id phoneChannelId") {
      id: ID!
      phoneChannelId: ID!
      title: String!
    }

    type TaskDeleted @key(fields: "id phoneChannelId") {
      id: ID!
      phoneChannelId: ID!
    }
  `),
};

const subgraphUnionEDG: Subgraph = {
  name: 'subgraph-union-edg',
  url: '',
  definitions: parse(`
    type TaskUpdated @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    type TaskDeleted @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    union TaskEvent = TaskUpdated | TaskDeleted

    type Subscription {
      onTaskEvent(phoneChannelId: ID!): TaskEvent!
        @edfs__kafkaSubscribe(topics: ["taskEvent"])
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "phoneChannelId", values: ["{{ args.phoneChannelId }}"] } })
    }
  `),
};

const subgraphInterfaceResolver: Subgraph = {
  name: 'subgraph-interface-resolver',
  url: '',
  definitions: parse(`
    type Query {
      taskById(id: ID!): TaskUpdated
    }

    interface TaskEvent {
      id: ID!
      phoneChannelId: ID!
    }

    type TaskUpdated implements TaskEvent @key(fields: "id phoneChannelId") {
      id: ID!
      phoneChannelId: ID!
      title: String!
    }

    type TaskDeleted implements TaskEvent @key(fields: "id phoneChannelId") {
      id: ID!
      phoneChannelId: ID!
    }
  `),
};

const subgraphInterfaceEDG: Subgraph = {
  name: 'subgraph-interface-edg',
  url: '',
  definitions: parse(`
    interface TaskEvent {
      id: ID!
      phoneChannelId: ID!
    }

    type TaskUpdated implements TaskEvent @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    type TaskDeleted implements TaskEvent @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    type Subscription {
      onTaskEvent(phoneChannelId: ID!): TaskEvent!
        @edfs__kafkaSubscribe(topics: ["taskEvent"])
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "phoneChannelId", values: ["{{ args.phoneChannelId }}"] } })
    }
  `),
};

// Partial resolver — TaskDeleted has only `id`, so phoneChannelId is genuinely absent.
const subgraphUnionResolverPartial: Subgraph = {
  name: 'subgraph-union-resolver-partial',
  url: '',
  definitions: parse(`
    type Query {
      task(id: ID!): TaskUpdated
    }

    type TaskUpdated @key(fields: "id phoneChannelId") {
      id: ID!
      phoneChannelId: ID!
      title: String!
    }

    type TaskDeleted @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphUnionMemberMissingField: Subgraph = {
  name: 'subgraph-union-member-missing-field',
  url: '',
  definitions: parse(`
    type TaskUpdated @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    type TaskDeleted @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    union TaskEvent = TaskUpdated | TaskDeleted

    type Subscription {
      onTaskEvent(phoneChannelId: ID!): TaskEvent!
        @edfs__kafkaSubscribe(topics: ["taskEvent"])
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "phoneChannelId", values: ["{{ args.phoneChannelId }}"] } })
    }
  `),
};

const subgraphUnionInaccessibleMemberMissingField: Subgraph = {
  name: 'subgraph-union-inaccessible-member-missing-field',
  url: '',
  definitions: parse(`
    type TaskUpdated @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    type TaskDeleted @inaccessible @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    union TaskEvent = TaskUpdated | TaskDeleted

    type Subscription {
      onTaskEvent(phoneChannelId: ID!): TaskEvent!
        @edfs__kafkaSubscribe(topics: ["taskEvent"])
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "phoneChannelId", values: ["{{ args.phoneChannelId }}"] } })
    }
  `),
};

const subgraphInterfaceResolverPartial: Subgraph = {
  name: 'subgraph-interface-resolver-partial',
  url: '',
  definitions: parse(`
    type Query {
      taskById(id: ID!): TaskUpdated
    }

    type TaskUpdated @key(fields: "id phoneChannelId") {
      id: ID!
      phoneChannelId: ID!
      title: String!
    }

    type TaskDeleted @key(fields: "id") {
      id: ID!
    }
  `),
};

const subgraphInterfaceImplementerMissingField: Subgraph = {
  name: 'subgraph-interface-implementer-missing-field',
  url: '',
  definitions: parse(`
    interface TaskEvent {
      id: ID!
    }

    type TaskUpdated implements TaskEvent @key(fields: "id phoneChannelId", resolvable: false) {
      id: ID! @external
      phoneChannelId: ID! @external
    }

    type TaskDeleted implements TaskEvent @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Subscription {
      onTaskEvent(phoneChannelId: ID!): TaskEvent!
        @edfs__kafkaSubscribe(topics: ["taskEvent"])
        @openfed__subscriptionFilter(condition: { IN: { fieldPath: "phoneChannelId", values: ["{{ args.phoneChannelId }}"] } })
    }
  `),
};
