import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  federateSubgraphs,
  invalidEventDrivenGraphError,
  invalidEventsDrivenMutationResponseTypeErrorMessage,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  InvalidRootTypeFieldEventsDirectiveData,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  nonEntityObjectExtensionsEventDrivenErrorMessage,
  nonExternalKeyFieldNamesEventDrivenErrorMessage,
  nonKeyFieldNamesEventDrivenErrorMessage,
  normalizeSubgraphFromString,
  Subgraph,
  subgraphValidationError,
} from '../src';
import { parse } from 'graphql';
import { DEFAULT, EVENTS_PUBLISH, EVENTS_REQUEST, EVENTS_SUBSCRIBE } from '../src/utils/string-constants';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionOnePersistedDirectiveDefinitions,
} from './utils/utils';

describe('events Configuration tests', () => {
  describe('Normalization tests', () => {
    test('that events configuration is correctly generated', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphStringA);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['findEntity']),
              isRootNode: true,
              typeName: 'Query',
              events: [
                {
                  fieldName: 'findEntity',
                  sourceName: DEFAULT,
                  topic: 'findEntity.{{ args.id }}',
                  type: 'request',
                },
              ],
            },
          ],
          [
            'PublishEventResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'PublishEventResult',
            },
          ],
          [
            'Mutation',
            {
              fieldNames: new Set<string>(['updateEntity']),
              isRootNode: true,
              typeName: 'Mutation',
              events: [
                {
                  fieldName: 'updateEntity',
                  sourceName: DEFAULT,
                  topic: 'updateEntity.{{ args.id }}',
                  type: 'publish',
                },
              ],
            },
          ],
          [
            'Subscription',
            {
              fieldNames: new Set<string>(['entitySubscription']),
              isRootNode: true,
              typeName: 'Subscription',
              events: [
                {
                  fieldName: 'entitySubscription',
                  sourceName: 'kafka',
                  topic: 'entities.{{ args.id }}',
                  type: 'subscribe',
                },
              ],
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that events configuration is correctly generated if Subscription is renamed', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphStringB);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Subscription',
            {
              fieldNames: new Set<string>(['entitySubscription']),
              isRootNode: true,
              typeName: 'Subscription',
              events: [
                {
                  fieldName: 'entitySubscription',
                  sourceName: DEFAULT,
                  topic: 'entities.{{ args.id }}',
                  type: 'subscribe',
                },
              ],
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that events configuration is correctly generated if sourceName is specified', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(subgraphStringC);
      expect(errors).toBeUndefined();
      expect(normalizationResult).toBeDefined();
      expect(normalizationResult!.configurationDataByParentTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Query',
            {
              fieldNames: new Set<string>(['findEntity']),
              isRootNode: true,
              typeName: 'Query',
              events: [
                {
                  fieldName: 'findEntity',
                  sourceName: 'myQuerySourceName',
                  topic: 'findEntity.{{ args.id }}',
                  type: 'request',
                },
              ],
            },
          ],
          [
            'PublishEventResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'PublishEventResult',
            },
          ],
          [
            'Mutation',
            {
              fieldNames: new Set<string>(['updateEntity']),
              isRootNode: true,
              typeName: 'Mutation',
              events: [
                {
                  fieldName: 'updateEntity',
                  sourceName: 'myMutationSourceName',
                  topic: 'updateEntity.{{ args.id }}',
                  type: 'publish',
                },
              ],
            },
          ],
          [
            'Subscription',
            {
              fieldNames: new Set<string>(['entitySubscription']),
              isRootNode: true,
              typeName: 'Subscription',
              events: [
                {
                  fieldName: 'entitySubscription',
                  sourceName: 'mySubscriptionSourceName',
                  topic: 'entities.{{ args.id }}',
                  type: 'subscribe',
                },
              ],
            },
          ],
          [
            'Entity',
            {
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });
  });

  describe('Federation tests', () => {
    test('that an error is returned if the subgraph includes fields that are not part of an entity key', () => {
      const { errors } = federateSubgraphs([subgraphC]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-c', [
          invalidEventDrivenGraphError([
            nonKeyFieldNamesEventDrivenErrorMessage(new Map<string, string>([['Entity.name', 'name']])),
          ]),
        ]),
      );
    });

    test('that an error is returned if the subgraph includes fields that are part of an entity key but not declared external', () => {
      const { errors } = federateSubgraphs([subgraphD]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-d', [
          invalidEventDrivenGraphError([
            nonExternalKeyFieldNamesEventDrivenErrorMessage(new Map<string, string>([['Entity.id', 'id']])),
          ]),
        ]),
      );
    });

    test('that an error is returned if the subgraph contains root type fields that do not define their respective events directives', () => {
      const { errors } = federateSubgraphs([subgraphE]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-e', [
          invalidEventDrivenGraphError([
            invalidRootTypeFieldEventsDirectivesErrorMessage(
              new Map<string, InvalidRootTypeFieldEventsDirectiveData>([
                ['Query.requestEntity', { definesDirectives: false, invalidDirectiveNames: [] }],
                ['Mutation.publishEntity', { definesDirectives: false, invalidDirectiveNames: [] }],
                ['Subscription.subscribeEntity', { definesDirectives: false, invalidDirectiveNames: [] }],
              ]),
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if the subgraph contains root type fields that do not return valid types', () => {
      const { errors } = federateSubgraphs([subgraphF]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-f', [
          invalidEventDrivenGraphError([
            invalidRootTypeFieldResponseTypesEventDrivenErrorMessage(
              new Map<string, string>([['Query.requestEntity', 'String!']]),
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if the subgraph contains root type fields that return a nullable or list type', () => {
      const { errors } = federateSubgraphs([subgraphM]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-m', [
          invalidEventDrivenGraphError([
            invalidRootTypeFieldResponseTypesEventDrivenErrorMessage(
              new Map<string, string>([
                ['Query.findEntity', 'Entity'],
                ['Subscription.entitySubscription', '[Entity!]!'],
              ]),
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if an entity key is defined without resolvable: false', () => {
      const { errors } = federateSubgraphs([subgraphG]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-g', [
          invalidEventDrivenGraphError([
            invalidKeyFieldSetsEventDrivenErrorMessage(new Map<string, string[]>([['Entity', ['id']]])),
          ]),
        ]),
      );
    });

    test('that an error is returned if the events graph contains a non-entity object extension', () => {
      const { errors } = federateSubgraphs([subgraphH]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-h', [
          invalidEventDrivenGraphError([nonEntityObjectExtensionsEventDrivenErrorMessage(['Object'])]),
        ]),
      );
    });

    test('that an interface implemented by an entity is a valid root type response named type', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          `schema {
          query: Query
          subscription: Subscription
        }` +
            versionOnePersistedDirectiveDefinitions +
            `
        type Entity implements Interface {
          id: ID!
          object: Object
        }
        
        interface Interface {
          id: ID!
        }
        
        type Object {
          id: ID!
        }
        
        type Query {
          findEntity(fieldSet: String!): Interface!
        }
        
        type Subscription {
          entitySubscription(fieldSet: String!): Interface!
        }
     `,
        ),
      );
    });

    test('that a union of which an entity is a member is a valid root type response named type', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphJ]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          `schema {
          query: Query
          subscription: Subscription
        }` +
            versionOnePersistedDirectiveDefinitions +
            `
        type Entity {
          id: ID!
          object: Object
        }
        
        type Object {
          id: ID!
        }
        
        type Query {
          findEntity(fieldSet: String!): Union!
        }
        
        type Subscription {
          entitySubscription(fieldSet: String!): Union!
        }
        
        union Union = Entity
     `,
        ),
      );
    });

    test('that an error is returned if there are invalid eventsDirective definitions', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphK]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-k', [
          invalidEventDrivenGraphError([
            invalidRootTypeFieldEventsDirectivesErrorMessage(
              new Map<string, InvalidRootTypeFieldEventsDirectiveData>([
                ['Query.findEntity', { definesDirectives: true, invalidDirectiveNames: [EVENTS_PUBLISH] }],
                ['Mutation.publishEntity', { definesDirectives: true, invalidDirectiveNames: [EVENTS_SUBSCRIBE] }],
                [
                  'Subscription.entitySubscription',
                  { definesDirectives: true, invalidDirectiveNames: [EVENTS_REQUEST] },
                ],
              ]),
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if a mutation type field does not return "PublishEventResult"', () => {
      const { errors } = federateSubgraphs([subgraphL]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-l', [
          invalidEventDrivenGraphError([
            invalidEventsDrivenMutationResponseTypeErrorMessage(
              new Map<string, string>([['Mutation.publishEntity', 'Entity!']]),
            ),
          ]),
        ]),
      );
    });
  });
});

const subgraphStringA = `
  type Query {
    findEntity(id: ID!): Entity! @eventsRequest(topic: "findEntity.{{ args.id }}")
  }

  type PublishEventResult {
   success: Boolean!
  }
  
  type Mutation {
    updateEntity(id: ID!, name: String!): PublishEventResult! @eventsPublish(topic: "updateEntity.{{ args.id }}")
  }

  type Subscription {
    entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}", sourceName: "kafka")
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
`;

const subgraphStringB = `
  schema {
    subscription: Subscriptions
  }
  
  type Subscriptions {
    entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
`;

const subgraphStringC = `
  type Query {
    findEntity(id: ID!): Entity! @eventsRequest(topic: "findEntity.{{ args.id }}", sourceName: "myQuerySourceName")
  }

  type PublishEventResult {
   success: Boolean!
  }
  
  type Mutation {
    updateEntity(id: ID!, name: String!): PublishEventResult! @eventsPublish(topic: "updateEntity.{{ args.id }}", sourceName: "myMutationSourceName")
  }
  
  type Subscription {
    entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}", sourceName: "mySubscriptionSourceName")
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
`;

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @eventsRequest(topic: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @eventsRequest(topic: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID!
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      requestEntity(id: ID!): Entity!
    }
    
    
    type PublishEventResult {
     success: Boolean!
    }
    
    type Mutation {
      publishEntity(id: ID!): PublishEventResult!
    }
    
    type Subscription {
      subscribeEntity(id: ID!): Entity!
      entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      requestEntity(id: ID!): String! @eventsRequest(topic: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @eventsRequest(topic: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id") {
      id: ID! @external
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(fieldSet: String!): Entity! @eventsRequest(topic: "findEntity.{{ args.fieldSet }}")
    }
    
    type Subscription {
      entitySubscription(fieldSet: String!): Entity! @eventsSubscribe(topic: "entities.{{ args.fieldSet }}")
    }
    
    type Entity @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object @external
    }
    
    extend type Object {
      id: ID! @external
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(fieldSet: String!): Interface! @eventsRequest(topic: "findEntity.{{ args.fieldSet }}")
    }
    
    type Subscription {
      entitySubscription(fieldSet: String!): Interface! @eventsSubscribe(topic: "entities.{{ args.fieldSet }}")
    }
    
    interface Interface {
      id: ID!
    }
    
    type Entity implements Interface @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object @external
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(fieldSet: String!): Union! @eventsRequest(topic: "findEntity.{{ args.fieldSet }}")
    }
    
    type Subscription {
      entitySubscription(fieldSet: String!): Union! @eventsSubscribe(topic: "entities.{{ args.fieldSet }}")
    }
    
    union Union = Entity
    
    type Entity @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object @external
    }
    
    type Object {
      id: ID! @external
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @eventsPublish(topic: "findEntity.{{ args.id }}")
    }
    
    type PublishEventResult {
     success: Boolean!
    }
    
    type Mutation {
      publishEntity(id: ID!): PublishEventResult! @eventsSubscribe(topic: "publishEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @eventsRequest(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Mutation {
      publishEntity(id: ID!): Entity! @eventsPublish(topic: "publishEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity @eventsRequest(topic: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): [Entity!]! @eventsSubscribe(topic: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};
