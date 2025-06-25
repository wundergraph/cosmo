import { describe, expect, test } from 'vitest';
import {
  allExternalFieldInstancesError,
  ConfigurationData,
  DEFAULT_EDFS_PROVIDER_ID,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_SUBSCRIBE,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  FIRST_ORDINAL,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  invalidEventDirectiveError,
  invalidEventDrivenGraphError,
  invalidEventDrivenMutationResponseTypeErrorMessage,
  invalidEventProviderIdErrorMessage,
  invalidEventSubjectsItemErrorMessage,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  invalidNatsStreamConfigurationDefinitionErrorMessage,
  invalidNatsStreamInputFieldsErrorMessage,
  InvalidRootTypeFieldEventsDirectiveData,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  noBaseDefinitionForExtensionError,
  nonExternalKeyFieldNamesEventDrivenErrorMessage,
  nonKeyFieldNamesEventDrivenErrorMessage,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  OBJECT,
  parse,
  PROVIDER_ID,
  PROVIDER_TYPE_KAFKA,
  PROVIDER_TYPE_NATS,
  PROVIDER_TYPE_REDIS,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  subgraphValidationError,
  SUBJECTS,
  undefinedEventSubjectsArgumentErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
} from '../../src';
import {
  versionOneFullEventDefinitions,
  versionOnePersistedDirectiveDefinitions,
  versionOneSubscriptionEventDefinitions,
} from './utils/utils';
import {
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../utils/utils';

describe('events Configuration tests', () => {
  describe('Normalization tests', () => {
    test('that events configuration is correctly generated', () => {
      const result = normalizeSubgraphSuccess(subgraphA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
                  providerId: DEFAULT_EDFS_PROVIDER_ID,
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['findEntity.{{ args.id }}'],
                  type: 'request',
                },
              ],
            },
          ],
          [
            'edfs__PublishResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'edfs__PublishResult',
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
                  providerId: DEFAULT_EDFS_PROVIDER_ID,
                  providerType: PROVIDER_TYPE_NATS,
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
                  providerId: 'my-provider',
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['entities.{{ args.id }}'],
                  type: 'subscribe',
                },
                {
                  fieldName: 'entitySubscriptionTwo',
                  providerId: 'double',
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['firstSub.{{ args.firstID }}', 'secondSub.{{ args.secondID }}'],
                  type: 'subscribe',
                  streamConfiguration: {
                    consumerInactiveThreshold: 300,
                    consumerName: 'consumer',
                    streamName: 'streamName',
                  },
                },
              ],
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          versionOneFullEventDefinitions +
            `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Mutation {
          updateEntity(id: ID!, name: String!): edfs__PublishResult! @edfs__natsPublish(subject: "updateEntity.{{ args.id }}")
        }

        type Query {
          findEntity(id: ID!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
        }

        type Subscription {
          entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"], providerId: "my-provider")
          entitySubscriptionTwo(firstID: ID!, secondID: ID!): Entity! @edfs__natsSubscribe(subjects: ["firstSub.{{ args.firstID }}", "secondSub.{{ args.secondID }}"], providerId: "double", streamConfiguration: {consumerName: "consumer", streamName: "streamName", consumerInactiveThreshold: 300})
        }

        input edfs__NatsStreamConfiguration {
          consumerInactiveThreshold: Int! = 30
          consumerName: String!
          streamName: String!
        }

        type edfs__PublishResult {
         success: Boolean!
        }

        scalar openfed__FieldSet
      `,
        ),
      );
    });

    test('that events configuration is correctly generated if Subscription is renamed', () => {
      const result = normalizeSubgraphFromString(
        subgraphStringB,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
                  providerId: DEFAULT_EDFS_PROVIDER_ID,
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['entities.{{ args.id }}'],
                  type: 'subscribe',
                },
              ],
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
              typeName: 'Entity',
            },
          ],
        ]),
      );
    });

    test('that events configuration is correctly generated if providerId is specified', () => {
      const result = normalizeSubgraphFromString(
        subgraphStringC,
        true,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.configurationDataByTypeName).toStrictEqual(
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
                  providerId: 'myQuerySourceName',
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['findEntity.{{ args.id }}'],
                  type: 'request',
                },
              ],
            },
          ],
          [
            'edfs__PublishResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'edfs__PublishResult',
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
                  providerId: 'myMutationSourceName',
                  providerType: PROVIDER_TYPE_NATS,
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
                  providerId: 'mySubscriptionSourceName',
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['entities.{{ args.id }}'],
                  type: 'subscribe',
                },
              ],
            },
          ],
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id']),
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
      const result = normalizeSubgraphFailure(subgraphN, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(2);
      const rootFieldPath = 'Subscription.entitySubscription';
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError(EDFS_NATS_SUBSCRIBE, rootFieldPath, [
          invalidEventSubjectsItemErrorMessage(SUBJECTS),
          invalidEventProviderIdErrorMessage,
        ]),
      );
      expect(result.errors[1]).toStrictEqual(
        invalidDirectiveError(EDFS_NATS_SUBSCRIBE, rootFieldPath, FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('[1]', `@${EDFS_NATS_SUBSCRIBE}`, SUBJECTS, '[String!]!'),
          invalidArgumentValueErrorMessage('false', `@${EDFS_NATS_SUBSCRIBE}`, PROVIDER_ID, 'String!'),
          duplicateDirectiveArgumentDefinitionsErrorMessage([SUBJECTS, PROVIDER_ID]),
          unexpectedDirectiveArgumentErrorMessage(EDFS_NATS_SUBSCRIBE, ['unknownArgument']),
        ]),
      );
    });

    test('that errors are returned if an event directive is invalid #2', () => {
      const result = normalizeSubgraphFailure(subgraphR, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      const directiveName = 'edfs__natsSubscribe';
      const rootFieldPath = 'Subscription.entitySubscription';
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(directiveName, rootFieldPath, FIRST_ORDINAL, [
          undefinedRequiredArgumentsErrorMessage(directiveName, ['subjects'], []),
        ]),
      );
    });

    test('that an error is returned if edfs__NatsStreamConfiguration is improperly defined', () => {
      const result = normalizeSubgraphFailure(subgraphP, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDrivenGraphError([invalidNatsStreamConfigurationDefinitionErrorMessage]),
      );
    });

    test('that an error is returned if streamConfiguration input is invalid #1', () => {
      const result = normalizeSubgraphFailure(subgraphQ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsSubscribe', 'Subscription.entitySubscription', [
          invalidNatsStreamInputFieldsErrorMessage(['streamName'], ['consumerName'], [], ['invalidField']),
        ]),
      );
    });

    test('that an error is returned if streamConfiguration input is invalid #2', () => {
      const result = normalizeSubgraphFailure(subgraphS, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsSubscribe', 'Subscription.entitySubscription', [
          invalidNatsStreamInputFieldsErrorMessage([], [], ['consumerName', 'streamName'], []),
        ]),
      );
    });

    test('that an error is returned if streamConfiguration input is invalid #3', () => {
      const result = normalizeSubgraphFailure(subgraphT, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsSubscribe', 'Subscription.entitySubscription', [
          invalidNatsStreamInputFieldsErrorMessage(
            ['consumerName', 'streamName'],
            [],
            [],
            ['invalidFieldOne', 'invalidFieldTwo'],
          ),
        ]),
      );
    });

    test('that edfs__NatsStreamConfiguration does not need to be defined if @edfs__natsSubscribe is not defined', () => {
      const result = normalizeSubgraphSuccess(subgraphU, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.configurationDataByTypeName).toStrictEqual(
        new Map<string, ConfigurationData>([
          [
            'Entity',
            {
              externalFieldNames: new Set<string>(['id']),
              fieldNames: new Set<string>(['id']),
              isRootNode: true,
              keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
              typeName: 'Entity',
            },
          ],
          [
            'Mutation',
            {
              fieldNames: new Set<string>(['kafkaMutation', 'natsMutation']),
              isRootNode: true,
              typeName: 'Mutation',
              events: [
                {
                  fieldName: 'kafkaMutation',
                  providerId: 'myKafka',
                  providerType: PROVIDER_TYPE_KAFKA,
                  topics: ['entityAdded'],
                  type: 'publish',
                },
                {
                  fieldName: 'natsMutation',
                  providerId: 'myNats',
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['updateEntity.{{ args.id }}'],
                  type: 'publish',
                },
              ],
            },
          ],
          [
            'Query',
            {
              fieldNames: new Set<string>(['natsQuery']),
              isRootNode: true,
              typeName: 'Query',
              events: [
                {
                  fieldName: 'natsQuery',
                  providerId: 'myNats',
                  providerType: PROVIDER_TYPE_NATS,
                  subjects: ['updateEntity.{{ args.id }}'],
                  type: 'request',
                },
              ],
            },
          ],
          [
            'Subscription',
            {
              fieldNames: new Set<string>(['kafkaSubscription']),
              isRootNode: true,
              typeName: 'Subscription',
              events: [
                {
                  fieldName: 'kafkaSubscription',
                  providerId: 'myKafka',
                  providerType: PROVIDER_TYPE_KAFKA,
                  topics: ['entityAdded', 'entityUpdated'],
                  type: 'subscribe',
                },
              ],
            },
          ],
          [
            'edfs__PublishResult',
            {
              fieldNames: new Set<string>(['success']),
              isRootNode: false,
              typeName: 'edfs__PublishResult',
            },
          ],
        ]),
      );
    });

    test('that an error is returned if a NATS subscribe subject references an invalid argument', () => {
      const result = normalizeSubgraphFailure(subgraphW, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsSubscribe', 'Subscription.entitySubscription', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
        ]),
      );
    });

    test('that an error is returned if a NATS request subject references an invalid argument', () => {
      const result = normalizeSubgraphFailure(subgraphX, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsRequest', 'Query.entityRequest', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
        ]),
      );
    });

    test('that an error is returned if a NATS publish subject references an invalid argument', () => {
      const result = normalizeSubgraphFailure(subgraphY, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsPublish', 'Mutation.entityPublish', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
        ]),
      );
    });

    test('that an error is returned if a Kafka subscribe subject references an invalid argument', () => {
      const result = normalizeSubgraphFailure(subgraphZ, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__kafkaSubscribe', 'Subscription.entitySubscription', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
        ]),
      );
    });

    test('that an error is returned if a Kafka publish subject references an invalid argument', () => {
      const result = normalizeSubgraphFailure(subgraphAA, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__kafkaPublish', 'Mutation.entityPublish', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
        ]),
      );
    });

    test('that an error is returned if a NATS subscribe subject references two invalid arguments', () => {
      const result = normalizeSubgraphFailure(subgraphAB, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsSubscribe', 'Subscription.entitySubscription', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
          undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
        ]),
      );
    });

    test('that an error is returned if a NATS request subject references two invalid arguments', () => {
      const result = normalizeSubgraphFailure(subgraphAC, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsRequest', 'Query.entityRequest', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
          undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
        ]),
      );
    });

    test('that an error is returned if a NATS publish subject references two invalid arguments', () => {
      const result = normalizeSubgraphFailure(subgraphAD, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__natsPublish', 'Mutation.entityPublish', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
          undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
        ]),
      );
    });

    test('that an error is returned if a Kafka subscribe subject references two invalid arguments', () => {
      const result = normalizeSubgraphFailure(subgraphAE, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__kafkaSubscribe', 'Subscription.entitySubscription', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
          undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
        ]),
      );
    });

    test('that an error is returned if a Kafka publish subject references two invalid arguments', () => {
      const result = normalizeSubgraphFailure(subgraphAF, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidEventDirectiveError('edfs__kafkaPublish', 'Mutation.entityPublish', [
          undefinedEventSubjectsArgumentErrorMessage('invalid'),
          undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
        ]),
      );
    });
  });

  test('that an error is returned if a NATS subscribe subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAG, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__natsSubscribe', 'Subscription.entitySubscription', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a NATS request subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAH, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__natsRequest', 'Query.entityRequest', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a NATS request subject uses streamConfiguration and there is a wrong definition of edfs__NatsStreamConfiguration', () => {
    const result = normalizeSubgraphFailure(subgraphAN, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDrivenGraphError([invalidNatsStreamConfigurationDefinitionErrorMessage]),
    );
  });

  test('that no error is returned if a NATS request subject is without streamConfiguration and there is a wrong definition of edfs__NatsStreamConfiguration', () => {
    const result = normalizeSubgraphSuccess(subgraphAO, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.schema)).toBe(
      normalizeString(
        versionOneSubscriptionEventDefinitions +
          `
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"]
      )
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }

    scalar openfed__FieldSet
      `,
      ),
    );
  });

  test('that no error is returned if a NATS request subject is with a streamConfiguration and there is a correct definition of edfs__NatsStreamConfiguration', () => {
    const result = normalizeSubgraphSuccess(subgraphAP, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(result.schema)).toBe(
      normalizeString(
        versionOneSubscriptionEventDefinitions +
          `
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"], 
        streamConfiguration: {consumerInactiveThreshold: 300, consumerName: "consumer", streamName: "streamName"}
      )
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }

    scalar openfed__FieldSet
      `,
      ),
    );
  });

  test('that an error is returned if a NATS request subject is with a streamConfiguration and there is a definition of edfs__NatsStreamConfiguration without default consumerInactiveThreshold', () => {
    const result = normalizeSubgraphFailure(subgraphAQ, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDrivenGraphError([invalidNatsStreamConfigurationDefinitionErrorMessage]),
    );
  });

  test('that an error is returned if a NATS request subject is with a streamConfiguration and there is a definition of edfs__NatsStreamConfiguration with an incorrect consumerInactiveThreshold default value', () => {
    const result = normalizeSubgraphFailure(subgraphAR, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDrivenGraphError([invalidNatsStreamConfigurationDefinitionErrorMessage]),
    );
  });

  test('that an error is returned if a NATS publish subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAI, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__natsPublish', 'Mutation.entityPublish', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a Kafka subscribe subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAL, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__kafkaSubscribe', 'Subscription.entitySubscription', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a Kafka publish subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAM, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__kafkaPublish', 'Mutation.entityPublish', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a Redis subscribe subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAS, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__redisSubscribe', 'Subscription.entitySubscription', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a Redis publish subject references a valid argument and an invalid one', () => {
    const result = normalizeSubgraphFailure(subgraphAT, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__redisPublish', 'Mutation.entityPublish', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
      ]),
    );
  });

  test('that an error is returned if a Redis subscribe subject references two invalid arguments', () => {
    const result = normalizeSubgraphFailure(subgraphAU, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__redisSubscribe', 'Subscription.entitySubscription', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
        undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
      ]),
    );
  });

  test('that an error is returned if a Redis publish subject references two invalid arguments', () => {
    const result = normalizeSubgraphFailure(subgraphAV, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidEventDirectiveError('edfs__redisPublish', 'Mutation.entityPublish', [
        undefinedEventSubjectsArgumentErrorMessage('invalid'),
        undefinedEventSubjectsArgumentErrorMessage('alsoinvalid'),
      ]),
    );
  });

  test('that Redis configuration is correctly generated', () => {
    const result = normalizeSubgraphSuccess(subgraphAW, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(result.configurationDataByTypeName).toStrictEqual(
      new Map<string, ConfigurationData>([
        [
          'Entity',
          {
            externalFieldNames: new Set<string>(['id']),
            fieldNames: new Set<string>(['id']),
            isRootNode: true,
            keys: [{ fieldName: '', selectionSet: 'id', disableEntityResolver: true }],
            typeName: 'Entity',
          },
        ],
        [
          'Mutation',
          {
            fieldNames: new Set<string>(['redisMutation']),
            isRootNode: true,
            typeName: 'Mutation',
            events: [
              {
                fieldName: 'redisMutation',
                providerId: 'myRedis',
                providerType: PROVIDER_TYPE_REDIS,
                channels: ['entityAdded'],
                type: 'publish',
              },
            ],
          },
        ],
        [
          'Subscription',
          {
            fieldNames: new Set<string>(['redisSubscription']),
            isRootNode: true,
            typeName: 'Subscription',
            events: [
              {
                fieldName: 'redisSubscription',
                providerId: 'myRedis',
                providerType: PROVIDER_TYPE_REDIS,
                channels: ['entityAdded', 'entityUpdated'],
                type: 'subscribe',
              },
            ],
          },
        ],
        [
          'edfs__PublishResult',
          {
            fieldNames: new Set<string>(['success']),
            isRootNode: false,
            typeName: 'edfs__PublishResult',
          },
        ],
      ]),
    );
  });

  describe('Federation tests', () => {
    test('that an error is returned if the subgraph includes fields that are not part of an entity key', () => {
      const result = federateSubgraphs([subgraphC], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-c', [
          invalidEventDrivenGraphError([
            nonKeyFieldNamesEventDrivenErrorMessage(new Map<string, string>([['Entity.name', 'name']])),
          ]),
        ]),
      );
    });

    test('that an error is returned if the subgraph includes fields that are part of an entity key but not declared external', () => {
      const result = federateSubgraphs([subgraphD], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-d', [
          invalidEventDrivenGraphError([
            nonExternalKeyFieldNamesEventDrivenErrorMessage(new Map<string, string>([['Entity.id', 'id']])),
          ]),
        ]),
      );
    });

    test('that an error is returned if the subgraph contains root type fields that do not define their respective events directives', () => {
      const result = federateSubgraphs([subgraphE], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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
      const result = federateSubgraphs([subgraphF], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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
      const result = federateSubgraphs([subgraphM], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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
      const result = federateSubgraphs([subgraphG], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-g', [
          invalidEventDrivenGraphError([
            invalidKeyFieldSetsEventDrivenErrorMessage(new Map<string, string[]>([['Entity', ['id']]])),
          ]),
        ]),
      );
    });

    test('that an error is returned if the events graph contains a non-entity object extension', () => {
      const result = federateSubgraphs([subgraphH], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toStrictEqual(
        allExternalFieldInstancesError(
          'Entity',
          new Map<string, Array<string>>([
            ['id', ['subgraph-h']],
            ['object', ['subgraph-h']],
          ]),
        ),
      );
      expect(result.errors[1]).toStrictEqual(noBaseDefinitionForExtensionError(OBJECT, OBJECT));
      expect(result.errors[2]).toStrictEqual(
        allExternalFieldInstancesError(OBJECT, new Map<string, Array<string>>([['id', ['subgraph-h']]])),
      );
    });

    test('that an interface implemented by an entity is a valid root type response named type', () => {
      const result = federateSubgraphs(
        [subgraphI, subgraphV],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphJ, subgraphV],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([subgraphK], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        subgraphValidationError('subgraph-k', [
          invalidEventDrivenGraphError([
            invalidRootTypeFieldEventsDirectivesErrorMessage(
              new Map<string, InvalidRootTypeFieldEventsDirectiveData>([
                ['Query.findEntity', { definesDirectives: true, invalidDirectiveNames: [EDFS_NATS_PUBLISH] }],
                ['Mutation.publishEntity', { definesDirectives: true, invalidDirectiveNames: [EDFS_NATS_SUBSCRIBE] }],
                [
                  'Subscription.entitySubscription',
                  { definesDirectives: true, invalidDirectiveNames: [EDFS_NATS_REQUEST] },
                ],
              ]),
            ),
          ]),
        ]),
      );
    });

    test('that an error is returned if a mutation type field does not return "edfs__PublishResult"', () => {
      const result = federateSubgraphs([subgraphL], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
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

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
    }

    type edfs__PublishResult {
     success: Boolean!
    }

    type Mutation {
      updateEntity(id: ID!, name: String!): edfs__PublishResult! @edfs__natsPublish(subject: "updateEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"], providerId: "my-provider")
      entitySubscriptionTwo(firstID: ID!, secondID: ID!): Entity! @edfs__natsSubscribe(subjects: ["firstSub.{{ args.firstID }}", "secondSub.{{ args.secondID }}"], providerId: "double", streamConfiguration: {consumerName: "consumer", streamName: "streamName", consumerInactiveThreshold: 300})
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphStringB = `
  schema {
    subscription: Subscriptions
  }

  type Subscriptions {
    entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
  }

  type Entity @key(fields: "id", resolvable: false) {
    id: ID! @external
  }
`;

const subgraphStringC = `
  type Query {
    findEntity(id: ID!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.id }}", providerId: "myQuerySourceName")
  }

  type edfs__PublishResult {
   success: Boolean!
  }

  type Mutation {
    updateEntity(id: ID!, name: String!): edfs__PublishResult! @edfs__natsPublish(subject: "updateEntity.{{ args.id }}", providerId: "myMutationSourceName")
  }

  type Subscription {
    entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"], providerId: "mySubscriptionSourceName")
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
      findEntity(id: ID!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
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
      findEntity(id: ID!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
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


    type edfs__PublishResult {
     success: Boolean!
    }

    type Mutation {
      publishEntity(id: ID!): edfs__PublishResult!
    }

    type Subscription {
      subscribeEntity(id: ID!): Entity!
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
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
      requestEntity(id: ID!): String! @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
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
      findEntity(id: ID!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
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
      findEntity(fieldSet: String!): Entity! @edfs__natsRequest(subject: "findEntity.{{ args.fieldSet }}")
    }

    type Subscription {
      entitySubscription(fieldSet: String!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.fieldSet }}"])
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
      findEntity(fieldSet: String!): Interface! @edfs__natsRequest(subject: "findEntity.{{ args.fieldSet }}")
    }

    type Subscription {
      entitySubscription(fieldSet: String!): Interface! @edfs__natsSubscribe(subjects: ["entities.{{ args.fieldSet }}"])
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
      findEntity(fieldSet: String!): Union! @edfs__natsRequest(subject: "findEntity.{{ args.fieldSet }}")
    }

    type Subscription {
      entitySubscription(fieldSet: String!): Union! @edfs__natsSubscribe(subjects: ["entities.{{ args.fieldSet }}"])
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
      findEntity(id: ID!): Entity! @edfs__natsPublish(subject: "findEntity.{{ args.id }}")
    }

    type edfs__PublishResult {
     success: Boolean!
    }

    type Mutation {
      publishEntity(id: ID!): edfs__PublishResult! @edfs__natsSubscribe(subjects: ["publishEntity.{{ args.id }}"])
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsRequest(subject: "entities.{{ args.id }}")
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Mutation {
      publishEntity(id: ID!): Entity! @edfs__natsPublish(subject: "publishEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      findEntity(id: ID!): Entity @edfs__natsRequest(subject: "findEntity.{{ args.id }}")
    }

    type Subscription {
      entitySubscription(id: ID!): [Entity!]! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: [1], subjects: ["topic"], providerId: false, providerId: "providerId", unknownArgument: null)
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"])
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
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(subjects: ["entities.{{ args.id }}"], streamConfiguration: { consumerName: "consumerName", streamName: "streamName" })
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    scalar edfs__NatsStreamConfiguration
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: { consumerName: "consumerName", consumerName: "hello", invalidField: 1 }
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: { consumerName: 1, streamName: "", }
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: { invalidFieldOne: 1, invalidFieldTwo: "test", }
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Mutation {
      kafkaMutation: edfs__PublishResult! @edfs__kafkaPublish(topic: "entityAdded", providerId: "myKafka")
      natsMutation(id: ID!): edfs__PublishResult! @edfs__natsPublish(subject: "updateEntity.{{ args.id }}", providerId: "myNats")
    }

    type Query {
      natsQuery(id: ID!): Entity! @edfs__natsRequest(subject: "updateEntity.{{ args.id }}", providerId: "myNats")
    }

    type Subscription {
      kafkaSubscription: Entity! @edfs__kafkaSubscribe(topics: ["entityAdded", "entityUpdated"], providerId: "myKafka")
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`

    type Entity @key(fields: "id object { id }") {
      id: ID!
      object: Object
    }

    type Object {
      id: ID!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.invalid }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    type Query {
      entityRequest(id: ID!): Entity! @edfs__natsRequest(
        subject: "entities.{{ args.invalid }}",
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__natsPublish(
        subject: "entities.{{ args.invalid }}",
      )
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__kafkaSubscribe(
        topics: ["entities.{{ args.invalid }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__kafkaPublish(
        topic: "entities.{{ args.invalid }}",
      )
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.invalid }}{{ args.alsoinvalid }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    type Query {
      entityRequest(id: ID!): Entity! @edfs__natsRequest(
        subject: "entities.{{ args.invalid }}{{ args.alsoinvalid }}",
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__natsPublish(
        subject: "entities.{{ args.invalid }}{{ args.alsoinvalid }}",
      )
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAE: Subgraph = {
  name: 'subgraph-ae',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__kafkaSubscribe(
        topics: ["entities.{{ args.invalid }}{{ args.alsoinvalid }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAF: Subgraph = {
  name: 'subgraph-af',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__kafkaPublish(
        topic: "entities.{{ args.invalid }}{{ args.alsoinvalid }}",
      )
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAG: Subgraph = {
  name: 'subgraph-ag',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.invalid }}{{ args.id }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAH: Subgraph = {
  name: 'subgraph-aH',
  url: '',
  definitions: parse(`
    type Query {
      entityRequest(id: ID!): Entity! @edfs__natsRequest(
        subject: "entities.{{ args.invalid }}{{ args.id }}",
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAI: Subgraph = {
  name: 'subgraph-ai',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__natsPublish(
        subject: "entities.{{ args.invalid }}{{ args.id }}",
      )
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAL: Subgraph = {
  name: 'subgraph-al',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__kafkaSubscribe(
        topics: ["entities.{{ args.invalid }}{{ args.id }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAM: Subgraph = {
  name: 'subgraph-am',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__kafkaPublish(
        topic: "entities.{{ args.invalid }}{{ args.id }}",
      )
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAN: Subgraph = {
  name: 'subgraph-an',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: {consumerName: "consumer", streamName: "streamName"}
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: String!
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAO: Subgraph = {
  name: 'subgraph-ao',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: String!
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAP: Subgraph = {
  name: 'subgraph-ap',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: {consumerInactiveThreshold: 300, consumerName: "consumer", streamName: "streamName"}
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 30
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAQ: Subgraph = {
  name: 'subgraph-aq',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: {consumerInactiveThreshold: 300, consumerName: "consumer", streamName: "streamName"}
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int!
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAR: Subgraph = {
  name: 'subgraph-ar',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__natsSubscribe(
        subjects: ["entities.{{ args.id }}"],
        streamConfiguration: {consumerInactiveThreshold: 300, consumerName: "consumer", streamName: "streamName"}
      )
    }

    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    input edfs__NatsStreamConfiguration {
      consumerInactiveThreshold: Int! = 40
      consumerName: String!
      streamName: String!
    }
  `),
};

const subgraphAS: Subgraph = {
  name: 'subgraph-as',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__redisSubscribe(
        channels: ["entities.{{ args.invalid }}{{ args.id }}"],
      )
    }
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAT: Subgraph = {
  name: 'subgraph-at',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__redisPublish(
        channel: "entities.{{ args.invalid }}{{ args.id }}",
      )
    }
    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAU: Subgraph = {
  name: 'subgraph-au',
  url: '',
  definitions: parse(`
    type Subscription {
      entitySubscription(id: ID!): Entity! @edfs__redisSubscribe(
        channels: ["entities.{{ args.invalid }}{{ args.alsoinvalid }}"],
      )
    }
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }
  `),
};

const subgraphAV: Subgraph = {
  name: 'subgraph-av',
  url: '',
  definitions: parse(`
    type Mutation {
      entityPublish(id: ID!): edfs__PublishResult! @edfs__redisPublish(
        channel: "entities.{{ args.invalid }}{{ args.alsoinvalid }}",
      )
    }
    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAW: Subgraph = {
  name: 'subgraph-aw',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Mutation {
      redisMutation: edfs__PublishResult! @edfs__redisPublish(channel: "entityAdded", providerId: "myRedis")
    }

    type Subscription {
      redisSubscription: Entity! @edfs__redisSubscribe(channels: ["entityAdded", "entityUpdated"], providerId: "myRedis")
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAX: Subgraph = {
  name: 'subgraph-ax',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Mutation {
      redisMutation: edfs__PublishResult! @edfs__redisPublish(channel: "entityAdded", providerId: "myRedis", providerId: "myRedis2")
    }

    type Subscription {
      redisSubscription: Entity! @edfs__redisSubscribe(channels: ["entityAdded", "entityUpdated"], providerId: "myRedis", channels: ["entityAdded1", "entityUpdated1"])
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};

const subgraphAY: Subgraph = {
  name: 'subgraph-ay',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Mutation {
      redisMutation: edfs__PublishResult! @edfs__redisPublish(channel: "entityAdded", providerId: "myRedis", wrongArgument: "test")
    }

    type Subscription {
      redisSubscription: Entity! @edfs__redisSubscribe(channels: ["entityAdded", "entityUpdated"], providerId: "myRedis", anotherWrongArgument: "test2")
    }

    type edfs__PublishResult {
      success: Boolean!
    }
  `),
};
