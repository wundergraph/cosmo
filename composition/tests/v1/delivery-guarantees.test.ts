import { describe, expect, test } from 'vitest';
import {
  DEFAULT_EDFS_PROVIDER_ID,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_SUBSCRIBE,
  EDFS_REDIS_SUBSCRIBE,
  FIRST_ORDINAL,
  invalidArgumentValueErrorMessage,
  invalidDeliveryGuaranteeModeDefinitionErrorMessage,
  invalidDeliveryGuaranteesDefinitionErrorMessage,
  invalidDeliveryGuaranteesInputFieldsErrorMessage,
  invalidDirectiveError,
  invalidEventDirectiveError,
  invalidEventDrivenGraphError,
  PROVIDER_TYPE_KAFKA,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  unexpectedDirectiveArgumentErrorMessage,
} from '../../src';
import {
  EDFS_DELIVERY_GUARANTEE_MODE_ENUM,
  EDFS_DELIVERY_GUARANTEES_INPUT,
  EDFS_KAFKA_SUBSCRIBE_DIRECTIVE,
  EXTERNAL_DIRECTIVE,
  KEY_DIRECTIVE,
  OPENFED_FIELD_SET,
  SCHEMA_SUBSCRIPTION_DEFINITION,
} from './utils/utils';
import {
  createSubgraph,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../utils/utils';

describe('deliveryGuarantees tests', () => {
  test('that deliveryGuarantees is omitted from the Kafka event configuration if the argument is not defined', () => {
    const dgKafkaNone = createSubgraph(
      'dg-kafka-none',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"])
        }
      `,
    );

    const { configurationDataByTypeName } = normalizeSubgraphSuccess(dgKafkaNone, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(configurationDataByTypeName.get('Subscription')?.events).toStrictEqual([
      {
        fieldName: 'entitySubscription',
        providerId: DEFAULT_EDFS_PROVIDER_ID,
        providerType: PROVIDER_TYPE_KAFKA,
        topics: ['entities'],
        type: 'subscribe',
      },
    ]);
  });

  test('that deliveryGuarantees is omitted from the Kafka event configuration if the mode is OFF', () => {
    const dgKafkaOff = createSubgraph(
      'dg-kafka-off',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: OFF })
        }
      `,
    );

    const { configurationDataByTypeName } = normalizeSubgraphSuccess(dgKafkaOff, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(configurationDataByTypeName.get('Subscription')?.events).toStrictEqual([
      {
        fieldName: 'entitySubscription',
        providerId: DEFAULT_EDFS_PROVIDER_ID,
        providerType: PROVIDER_TYPE_KAFKA,
        topics: ['entities'],
        type: 'subscribe',
      },
    ]);
  });

  test('that deliveryGuarantees is omitted from the Kafka event configuration if the argument is null', () => {
    const dgKafkaNull = createSubgraph(
      'dg-kafka-null',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: null)
        }
      `,
    );

    const { configurationDataByTypeName } = normalizeSubgraphSuccess(dgKafkaNull, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(configurationDataByTypeName.get('Subscription')?.events).toStrictEqual([
      {
        fieldName: 'entitySubscription',
        providerId: DEFAULT_EDFS_PROVIDER_ID,
        providerType: PROVIDER_TYPE_KAFKA,
        topics: ['entities'],
        type: 'subscribe',
      },
    ]);
  });

  test('that the mode defaults to OFF if deliveryGuarantees is an empty object', () => {
    const dgKafkaEmpty = createSubgraph(
      'dg-kafka-empty',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: {})
        }
      `,
    );

    const { configurationDataByTypeName } = normalizeSubgraphSuccess(dgKafkaEmpty, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(configurationDataByTypeName.get('Subscription')?.events).toStrictEqual([
      {
        fieldName: 'entitySubscription',
        providerId: DEFAULT_EDFS_PROVIDER_ID,
        providerType: PROVIDER_TYPE_KAFKA,
        topics: ['entities'],
        type: 'subscribe',
      },
    ]);
  });

  test('that deliveryGuarantees is added to the Kafka event configuration if the mode is CURSOR', () => {
    const dgKafkaCursor = createSubgraph(
      'dg-kafka-cursor',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: CURSOR })
        }
      `,
    );

    const { configurationDataByTypeName, schema } = normalizeSubgraphSuccess(
      dgKafkaCursor,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(configurationDataByTypeName.get('Subscription')?.events).toStrictEqual([
      {
        deliveryGuarantees: { mode: 'CURSOR' },
        fieldName: 'entitySubscription',
        providerId: DEFAULT_EDFS_PROVIDER_ID,
        providerType: PROVIDER_TYPE_KAFKA,
        topics: ['entities'],
        type: 'subscribe',
      },
    ]);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        SCHEMA_SUBSCRIPTION_DEFINITION +
          EDFS_KAFKA_SUBSCRIBE_DIRECTIVE +
          EXTERNAL_DIRECTIVE +
          KEY_DIRECTIVE +
          `
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Subscription {
      entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: {mode: CURSOR})
    }
      ` +
          EDFS_DELIVERY_GUARANTEE_MODE_ENUM +
          EDFS_DELIVERY_GUARANTEES_INPUT +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that an error is returned if deliveryGuarantees is defined on @edfs__natsSubscribe', () => {
    const dgNatsCursor = createSubgraph(
      'dg-nats-cursor',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__natsSubscribe(
            subjects: ["entities"],
            streamConfiguration: { consumerName: "consumer", streamName: "stream" },
            deliveryGuarantees: { mode: CURSOR }
          )
        }

        input edfs__NatsStreamConfiguration {
          consumerInactiveThreshold: Int! = 30
          consumerName: String!
          streamName: String!
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgNatsCursor, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EDFS_NATS_SUBSCRIBE, 'Subscription.entitySubscription', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(EDFS_NATS_SUBSCRIBE, ['deliveryGuarantees']),
      ]),
    );
  });

  test('that an error is returned if deliveryGuarantees is defined on @edfs__redisSubscribe', () => {
    const dgRedisCursor = createSubgraph(
      'dg-redis-cursor',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__redisSubscribe(channels: ["entities"], deliveryGuarantees: { mode: CURSOR })
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgRedisCursor, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EDFS_REDIS_SUBSCRIBE, 'Subscription.entitySubscription', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(EDFS_REDIS_SUBSCRIBE, ['deliveryGuarantees']),
      ]),
    );
  });

  test('that an error is returned if deliveryGuarantees is not an object', () => {
    const dgKafkaNotObject = createSubgraph(
      'dg-kafka-not-object',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: CURSOR)
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgKafkaNotObject, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EDFS_KAFKA_SUBSCRIBE, 'Subscription.entitySubscription', FIRST_ORDINAL, [
        invalidArgumentValueErrorMessage(
          'CURSOR',
          `@${EDFS_KAFKA_SUBSCRIBE}`,
          'deliveryGuarantees',
          'edfs__DeliveryGuarantees',
        ),
      ]),
    );
  });

  test('that an error is returned if deliveryGuarantees defines an unknown field', () => {
    const dgKafkaUnknownField = createSubgraph(
      'dg-kafka-unknown-field',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: CURSOR, unknown: 1 })
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgKafkaUnknownField, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidEventDirectiveError(EDFS_KAFKA_SUBSCRIBE, 'Subscription.entitySubscription', [
        invalidDeliveryGuaranteesInputFieldsErrorMessage({ duplicateFieldNames: [], invalidFieldNames: ['unknown'] }),
      ]),
    );
  });

  test('that an error is returned if the deliveryGuarantees mode is not an enum value', () => {
    const dgKafkaStringMode = createSubgraph(
      'dg-kafka-string-mode',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: "CURSOR" })
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgKafkaStringMode, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidEventDirectiveError(EDFS_KAFKA_SUBSCRIBE, 'Subscription.entitySubscription', [
        invalidDeliveryGuaranteesInputFieldsErrorMessage({
          duplicateFieldNames: [],
          invalidFieldNames: [],
          invalidModeValue: '"CURSOR"',
        }),
      ]),
    );
  });

  test('that an error is returned if the deliveryGuarantees mode is an unknown enum value', () => {
    const dgKafkaUnknownMode = createSubgraph(
      'dg-kafka-unknown-mode',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: ALWAYS })
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgKafkaUnknownMode, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidEventDirectiveError(EDFS_KAFKA_SUBSCRIBE, 'Subscription.entitySubscription', [
        invalidDeliveryGuaranteesInputFieldsErrorMessage({
          duplicateFieldNames: [],
          invalidFieldNames: [],
          invalidModeValue: 'ALWAYS',
        }),
      ]),
    );
  });

  test('that the canonical definitions can be self-defined', () => {
    const dgKafkaCursorSelfDefined = createSubgraph(
      'dg-kafka-cursor-self-defined',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: CURSOR })
        }

        enum edfs__DeliveryGuaranteeMode {
          OFF
          CURSOR
        }

        input edfs__DeliveryGuarantees {
          mode: edfs__DeliveryGuaranteeMode! = OFF
        }
      `,
    );

    const { configurationDataByTypeName, schema } = normalizeSubgraphSuccess(
      dgKafkaCursorSelfDefined,
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(configurationDataByTypeName.get('Subscription')?.events?.[0]).toHaveProperty('deliveryGuarantees', {
      mode: 'CURSOR',
    });
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(
        SCHEMA_SUBSCRIPTION_DEFINITION +
          EDFS_KAFKA_SUBSCRIBE_DIRECTIVE +
          EXTERNAL_DIRECTIVE +
          KEY_DIRECTIVE +
          `
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Subscription {
      entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: {mode: CURSOR})
    }
      ` +
          EDFS_DELIVERY_GUARANTEE_MODE_ENUM +
          EDFS_DELIVERY_GUARANTEES_INPUT +
          OPENFED_FIELD_SET,
      ),
    );
  });

  test('that an error is returned if edfs__DeliveryGuarantees is improperly defined', () => {
    const dgKafkaInvalidInputDefinition = createSubgraph(
      'dg-kafka-invalid-input-definition',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: CURSOR })
        }

        enum edfs__DeliveryGuaranteeMode {
          OFF
          CURSOR
        }

        input edfs__DeliveryGuarantees {
          mode: edfs__DeliveryGuaranteeMode
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgKafkaInvalidInputDefinition, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(invalidEventDrivenGraphError([invalidDeliveryGuaranteesDefinitionErrorMessage]));
  });

  test('that an error is returned if edfs__DeliveryGuaranteeMode is improperly defined', () => {
    const dgKafkaInvalidEnumDefinition = createSubgraph(
      'dg-kafka-invalid-enum-definition',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: CURSOR })
        }

        enum edfs__DeliveryGuaranteeMode {
          OFF
          CURSOR
          ALWAYS
        }
      `,
    );

    const { errors } = normalizeSubgraphFailure(dgKafkaInvalidEnumDefinition, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(invalidEventDrivenGraphError([invalidDeliveryGuaranteeModeDefinitionErrorMessage]));
  });

  test('that a subgraph with deliveryGuarantees federates successfully', () => {
    const dgKafkaCursor = createSubgraph(
      'dg-kafka-cursor',
      `
        type Entity @key(fields: "id", resolvable: false) {
          id: ID! @external
        }

        type Subscription {
          entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"], deliveryGuarantees: { mode: CURSOR })
        }
      `,
    );

    const dgEntitySubgraph = createSubgraph(
      'dg-entity',
      `
        type Query {
          entity: Entity!
        }

        type Entity @key(fields: "id") {
          id: ID!
        }
      `,
    );

    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [dgKafkaCursor, dgEntitySubgraph],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(federatedGraphSchema.getType('edfs__DeliveryGuarantees')).toBeUndefined();
    expect(federatedGraphSchema.getType('edfs__DeliveryGuaranteeMode')).toBeUndefined();
  });
});
