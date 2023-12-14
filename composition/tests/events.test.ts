import { describe, expect, test } from 'vitest';
import { ConfigurationData, normalizeSubgraphFromString } from '../src';

describe('Pubsub Configuration tests', () => {
  test('that events configuration is correctly generated', () => {
    const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphA);
    expect(errors).toBeUndefined();
    expect(normalizationResult).toBeDefined();
    const configurationDataMap = normalizationResult!.configurationDataMap;
    expect(configurationDataMap).toStrictEqual(new Map<string, ConfigurationData>([
      ['Subscription', {
        fieldNames: new Set<string>(['entitySubscription']),
        isRootNode: true,
        typeName: 'Subscription',
        events: [{ fieldName: 'entitySubscription', topic: 'entities.{{ args.id }}', type: 'subscribe' }],
      }],
      ['Mutation', {
        fieldNames: new Set<string>(['updateEntity']),
        isRootNode: true,
        typeName: 'Mutation',
        events: [{ fieldName: 'updateEntity', topic: 'updateEntity.{{ args.id }}', type: 'publish' }],
      }],
      ['Query', {
        fieldNames: new Set<string>(['findEntity']),
        isRootNode: true,
        typeName: 'Query',
        events: [{ fieldName: 'findEntity', topic: 'findEntity.{{ args.id }}', type: 'request' }],
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
        events: [{ fieldName: 'entitySubscription', topic: 'entities.{{ args.id }}', type: 'subscribe' }],
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
  type Query {
    findEntity(id: ID!): Entity! @events_request(topic: "findEntity.{{ args.id }}")
  }

  type Mutation {
    updateEntity(id: ID!, name: String!): Entity! @events_publish(topic: "updateEntity.{{ args.id }}")
  }

  type Subscription {
    entitySubscription(id: ID!): Entity! @events_subscribe(topic: "entities.{{ args.id }}")
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
    entitySubscription(id: ID!): Entity! @events_subscribe(topic: "entities.{{ args.id }}")
  }
  
  type Entity @key(fields: "id") {
    id: ID!
    name: String!
    age: Int!
  }
`;
