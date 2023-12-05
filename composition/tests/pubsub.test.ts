import { describe, expect, test } from 'vitest';
import { ConfigurationData, normalizeSubgraphFromString, Subgraph } from '../src';

describe('Pubsub Configuration tests', () => {
  test('that pubsub configuration is correctly generated', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphA);
    expect(errors).toBeUndefined();
    expect(normalizationResult).toBeDefined();
    const configurationDataMap = normalizationResult!.configurationDataMap;
    expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
      ['Subscription', {
        fieldNames: new Set<string>(['entitySubscription']),
        isRootNode: true,
        typeName: 'Subscription',
        pubsubs: [{ fieldName: '', selectionSet: 'entities.{{ args.id }}' }],
      }],
      ['Entity', {
        fieldNames: new Set<string>(['id', 'name', 'age']),
        isRootNode: true,
        keys: [{ fieldName: '', selectionSet: 'id' }],
        typeName: 'Entity',
      }],
    ]));
  });

  test('that pubsub configuration is correctly generated if Subscription is renamed', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphB);
    expect(errors).toBeUndefined();
    expect(normalizationResult).toBeDefined();
    const configurationDataMap = normalizationResult!.configurationDataMap;
    expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
      ['Subscriptions', {
        fieldNames: new Set<string>(['entitySubscription']),
        isRootNode: true,
        typeName: 'Subscription',
        pubsubs: [{ fieldName: '', selectionSet: 'entities.{{ args.id }}' }],
      }],
      ['Entity', {
        fieldNames: new Set<string>(['id', 'name', 'age']),
        isRootNode: true,
        keys: [{ fieldName: '', selectionSet: 'id' }],
        typeName: 'Entity',
      }],
    ]));
  });
});

const subgraphA = `
  type Subscription {
    entitySubscription(id: ID!): Entity! @pubsub(topic: "entities.{{ args.id }}")
  }
  
  type Entity @key(fields: "id") {
    id: ID!
    name: String!
    age: Int!
  }
`;

const subgraphB = `
  schema {
    subscription: Subscriptions
  }
  
  type Subscriptions {
    entitySubscription(id: ID!): Entity! @pubsub(topic: "entities.{{ args.id }}")
  }
  
  type Entity @key(fields: "id") {
    id: ID!
    name: String!
    age: Int!
  }
`;