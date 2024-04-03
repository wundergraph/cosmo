import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  federateSubgraphs,
  invalidDirectiveError,
  invalidEventDirectiveError,
  invalidEventDrivenGraphError,
  invalidEventDrivenMutationResponseTypeErrorMessage,
  invalidEventDrivenStreamConfigurationInputFieldsErrorMessage,
  invalidEventSourceNameErrorMessage,
  invalidEventSubjectsItemErrorMessage,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  InvalidRootTypeFieldEventsDirectiveData,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  invalidStreamConfigurationInputErrorMessage,
  nonEntityObjectExtensionsEventDrivenErrorMessage,
  nonExternalKeyFieldNamesEventDrivenErrorMessage,
  nonKeyFieldNamesEventDrivenErrorMessage,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  Subgraph,
  subgraphValidationError,
  undefinedRequiredArgumentsErrorMessage,
  undefinedStreamConfigurationInputErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
} from '../src';
import { parse } from 'graphql';
import {
  DEFAULT,
  EDFS_EVENTS_PUBLISH,
  EDFS_EVENTS_REQUEST,
  EDFS_EVENTS_SUBSCRIBE,
  SOURCE_NAME,
  SUBJECTS,
} from '../src/utils/string-constants';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionOneFullEventDefinitions,
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
                  subjects: ['findEntity.{{ args.id }}'],
                  type: 'request',
                },
              ],
            },
          ],
          [
            'edfs__PublishEventResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'edfs__PublishEventResult',
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
                  subjects: ['updateEntity.{{ args.id }}'],
                  type: 'publish',
                },
              ],
            },
          ],
          [
            'Subscription',
            {
              fieldNames: new Set<string>(['entitySubscription', 'entitySubscriptionTwo']),
              isRootNode: true,
              typeName: 'Subscription',
              events: [
                {
                  fieldName: 'entitySubscription',
                  sourceName: 'kafka',
                  subjects: ['entities.{{ args.id }}'],
                  type: 'subscribe',
                },
                {
                  fieldName: 'entitySubscriptionTwo',
                  sourceName: 'double',
                  subjects: ['firstSub.{{ args.firstID }}', 'secondSub.{{ args.secondID }}'],
                  type: 'subscribe',
                  streamConfiguration: {
                    consumer: 'consumer',
                    streamName: 'streamName',
                  },
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
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          versionOneFullEventDefinitions +
            `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }
        
        type Mutation {
          updateEntity(id: ID!, name: String!): edfs__PublishEventResult! @edfs__eventsPublish(subject: "updateEntity.{{ args.id }}")
        }
        
        type Query {
          findEntity(id: ID!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
        }
      
        type Subscription {
          entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"], sourceName: "kafka")
          entitySubscriptionTwo(firstID: ID!, secondID: ID!): Entity! @edfs__eventsSubscribe(subjects: ["firstSub.{{ args.firstID }}", "secondSub.{{ args.secondID }}"], sourceName: "double", streamConfiguration: {consumer: "consumer", streamName: "streamName"})
        }
      
        type edfs__PublishEventResult {
         success: Boolean!
        }
        
        input edfs__StreamConfiguration {
          consumer: String!
          streamName: String!
        }
        
        scalar openfed__FieldSet
      `,
        ),
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
                  subjects: ['entities.{{ args.id }}'],
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
                  subjects: ['findEntity.{{ args.id }}'],
                  type: 'request',
                },
              ],
            },
          ],
          [
            'edfs__PublishEventResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'edfs__PublishEventResult',
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
                  subjects: ['updateEntity.{{ args.id }}'],
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
                  subjects: ['entities.{{ args.id }}'],
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

    test('that errors are returned if an event directive is invalid #1', () => {
      const { errors } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(3);
      const directiveName = 'edfs__eventsSubscribe';
      const rootFieldPath = 'Subscription.entitySubscription';
      expect(errors![0]).toStrictEqual(
        invalidEventDirectiveError(directiveName, rootFieldPath, [
          invalidEventSubjectsItemErrorMessage,
          invalidEventSourceNameErrorMessage,
        ]),
      );
      expect(errors![1]).toStrictEqual(
        invalidDirectiveError(directiveName, rootFieldPath, [
          duplicateDirectiveArgumentDefinitionsErrorMessage(directiveName, rootFieldPath, [SUBJECTS, SOURCE_NAME]),
          unexpectedDirectiveArgumentErrorMessage(directiveName, ['unknownArgument']),
        ]),
      );
      expect(errors![2]).toStrictEqual(
        invalidEventDrivenGraphError([
          invalidRootTypeFieldEventsDirectivesErrorMessage(
            new Map<string, InvalidRootTypeFieldEventsDirectiveData>([
              [rootFieldPath, { definesDirectives: false, invalidDirectiveNames: [] }],
            ]),
          ),
        ]),
      );
    });

    test('that errors are returned if an event directive is invalid #2', () => {
      const { errors } = normalizeSubgraph(subgraphR.definitions, subgraphR.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      const directiveName = 'edfs__eventsSubscribe';
      const rootFieldPath = 'Subscription.entitySubscription';
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError(directiveName, rootFieldPath, [
          undefinedRequiredArgumentsErrorMessage(directiveName, rootFieldPath, ['subjects'], []),
        ]),
      );
      expect(errors![1]).toStrictEqual(
        invalidEventDrivenGraphError([
          invalidRootTypeFieldEventsDirectivesErrorMessage(
            new Map<string, InvalidRootTypeFieldEventsDirectiveData>([
              [rootFieldPath, { definesDirectives: false, invalidDirectiveNames: [] }],
            ]),
          ),
        ]),
      );
    });

    test('that an error is returned if edfs__StreamConfiguration is undefined', () => {
      const { errors } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(invalidEventDrivenGraphError([undefinedStreamConfigurationInputErrorMessage]));
    });

    test('that an error is returned if edfs__StreamConfiguration is improperly defined', () => {
      const { errors } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(invalidEventDrivenGraphError([invalidStreamConfigurationInputErrorMessage]));
    });

    test('that an error is returned if streamConfiguration input is invalid #1', () => {
      const { errors } = normalizeSubgraph(subgraphQ.definitions, subgraphQ.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidEventDirectiveError('edfs__eventsSubscribe', 'Subscription.entitySubscription', [
          invalidEventDrivenStreamConfigurationInputFieldsErrorMessage(
            ['streamName'],
            ['consumer'],
            [],
            ['invalidField'],
          ),
        ]),
      );
    });

    test('that an error is returned if streamConfiguration input is invalid #2', () => {
      const { errors } = normalizeSubgraph(subgraphS.definitions, subgraphS.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidEventDirectiveError('edfs__eventsSubscribe', 'Subscription.entitySubscription', [
          invalidEventDrivenStreamConfigurationInputFieldsErrorMessage([], [], ['consumer', 'streamName'], []),
        ]),
      );
    });

    test('that an error is returned if streamConfiguration input is invalid #3', () => {
      const { errors } = normalizeSubgraph(subgraphT.definitions, subgraphT.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidEventDirectiveError('edfs__eventsSubscribe', 'Subscription.entitySubscription', [
          invalidEventDrivenStreamConfigurationInputFieldsErrorMessage(
            ['consumer', 'streamName'],
            [],
            [],
            ['invalidFieldOne', 'invalidFieldTwo'],
          ),
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
        
        input edfs__StreamConfiguration {
          consumer: String!
          streamName: String!
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
        
        input edfs__StreamConfiguration {
          consumer: String!
          streamName: String!
        }
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
                ['Query.findEntity', { definesDirectives: true, invalidDirectiveNames: [EDFS_EVENTS_PUBLISH] }],
                ['Mutation.publishEntity', { definesDirectives: true, invalidDirectiveNames: [EDFS_EVENTS_SUBSCRIBE] }],
                [
                  'Subscription.entitySubscription',
                  { definesDirectives: true, invalidDirectiveNames: [EDFS_EVENTS_REQUEST] },
                ],
              ]),
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if a mutation type field does not return "edfs__PublishEventResult"', () => {
      const { errors } = federateSubgraphs([subgraphL]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        subgraphValidationError('subgraph-l', [
          invalidEventDrivenGraphError([
            invalidEventDrivenMutationResponseTypeErrorMessage(
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
    findEntity(id: ID!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
  }

  type edfs__PublishEventResult {
   success: Boolean!
  }
  
  type Mutation {
    updateEntity(id: ID!, name: String!): edfs__PublishEventResult! @edfs__eventsPublish(subject: "updateEntity.{{ args.id }}")
  }

  type Subscription {
    entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"], sourceName: "kafka")
    entitySubscriptionTwo(firstID: ID!, secondID: ID!): Entity! @edfs__eventsSubscribe(subjects: ["firstSub.{{ args.firstID }}", "secondSub.{{ args.secondID }}"], sourceName: "double", streamConfiguration: {consumer: "consumer", streamName: "streamName"})
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
  
  input edfs__StreamConfiguration {
    consumer: String!
    streamName: String!
  }
`;

const subgraphStringB = `
  schema {
    subscription: Subscriptions
  }
  
  type Subscriptions {
    entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
  
  input edfs__StreamConfiguration {
    consumer: String!
    streamName: String!
  }
`;

const subgraphStringC = `
  type Query {
    findEntity(id: ID!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}", sourceName: "myQuerySourceName")
  }

  type edfs__PublishEventResult {
   success: Boolean!
  }
  
  type Mutation {
    updateEntity(id: ID!, name: String!): edfs__PublishEventResult! @edfs__eventsPublish(subject: "updateEntity.{{ args.id }}", sourceName: "myMutationSourceName")
  }
  
  type Subscription {
    entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"], sourceName: "mySubscriptionSourceName")
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
  
  input edfs__StreamConfiguration {
    consumer: String!
    streamName: String!
  }
`;

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
      name: String!
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID!
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
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
    
    
    type edfs__PublishEventResult {
     success: Boolean!
    }
    
    type Mutation {
      publishEntity(id: ID!): edfs__PublishEventResult!
    }
    
    type Subscription {
      subscribeEntity(id: ID!): Entity!
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      requestEntity(id: ID!): String! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id") {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(fieldSet: String!): Entity! @edfs__eventsRequest(subject: "findEntity.{{ args.fieldSet }}")
    }
    
    type Subscription {
      entitySubscription(fieldSet: String!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.fieldSet }}"])
    }
    
    type Entity @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object @external
    }
    
    extend type Object {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(fieldSet: String!): Interface! @edfs__eventsRequest(subject: "findEntity.{{ args.fieldSet }}")
    }
    
    type Subscription {
      entitySubscription(fieldSet: String!): Interface! @edfs__eventsSubscribe(subjects: ["entities.{{ args.fieldSet }}"])
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
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(fieldSet: String!): Union! @edfs__eventsRequest(subject: "findEntity.{{ args.fieldSet }}")
    }
    
    type Subscription {
      entitySubscription(fieldSet: String!): Union! @edfs__eventsSubscribe(subjects: ["entities.{{ args.fieldSet }}"])
    }
    
    union Union = Entity
    
    type Entity @key(fields: "id object { id }", resolvable: false) {
      id: ID! @external
      object: Object @external
    }
    
    type Object {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @edfs__eventsPublish(subject: "findEntity.{{ args.id }}")
    }
    
    type edfs__PublishEventResult {
     success: Boolean!
    }
    
    type Mutation {
      publishEntity(id: ID!): edfs__PublishEventResult! @edfs__eventsSubscribe(subjects: ["publishEntity.{{ args.id }}"])
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsRequest(subject: "entities.{{ args.id }}")
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Mutation {
      publishEntity(id: ID!): Entity! @edfs__eventsPublish(subject: "publishEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity @edfs__eventsRequest(subject: "findEntity.{{ args.id }}")
    }
    
    type Subscription {
      entitySubscription(id: ID!): [Entity!]! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: [1], subjects: ["topic"], sourceName: false, sourceName: "sourceName", unknownArgument: null)
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(subjects: ["entities.{{ args.id }}"])
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    scalar edfs__StreamConfiguration
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: { consumer: "consumerName", consumer: "hello", invalidField: 1 }
      )
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: { consumer: 1, streamName: "", }
      )
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__eventsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: { invalidFieldOne: 1, invalidFieldTwo: "test", }
      )
    }
    
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
    
    input edfs__StreamConfiguration {
      consumer: String!
      streamName: String!
    }
  `),
};
