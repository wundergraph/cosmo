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
  parse,
  PROVIDER_TYPE_KAFKA,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  type Subgraph,
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
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../utils/utils';

describe('deliveryGuarantees tests', () => {
  test('that deliveryGuarantees is omitted from the Kafka event configuration if the argument is not defined', () => {
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
    const { errors } = normalizeSubgraphFailure(dgNatsCursor, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EDFS_NATS_SUBSCRIBE, 'Subscription.entitySubscription', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(EDFS_NATS_SUBSCRIBE, ['deliveryGuarantees']),
      ]),
    );
  });

  test('that an error is returned if deliveryGuarantees is defined on @edfs__redisSubscribe', () => {
    const { errors } = normalizeSubgraphFailure(dgRedisCursor, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidDirectiveError(EDFS_REDIS_SUBSCRIBE, 'Subscription.entitySubscription', FIRST_ORDINAL, [
        unexpectedDirectiveArgumentErrorMessage(EDFS_REDIS_SUBSCRIBE, ['deliveryGuarantees']),
      ]),
    );
  });

  test('that an error is returned if deliveryGuarantees is not an object', () => {
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
    const { errors } = normalizeSubgraphFailure(dgKafkaUnknownField, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(
      invalidEventDirectiveError(EDFS_KAFKA_SUBSCRIBE, 'Subscription.entitySubscription', [
        invalidDeliveryGuaranteesInputFieldsErrorMessage({ duplicateFieldNames: [], invalidFieldNames: ['unknown'] }),
      ]),
    );
  });

  test('that an error is returned if the deliveryGuarantees mode is not an enum value', () => {
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
    const { errors } = normalizeSubgraphFailure(dgKafkaInvalidInputDefinition, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(invalidEventDrivenGraphError([invalidDeliveryGuaranteesDefinitionErrorMessage]));
  });

  test('that an error is returned if edfs__DeliveryGuaranteeMode is improperly defined', () => {
    const { errors } = normalizeSubgraphFailure(dgKafkaInvalidEnumDefinition, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStrictEqual(invalidEventDrivenGraphError([invalidDeliveryGuaranteeModeDefinitionErrorMessage]));
  });

  test('that a subgraph with deliveryGuarantees federates successfully', () => {
    const { federatedGraphSchema } = federateSubgraphsSuccess(
      [dgKafkaCursor, dgEntitySubgraph],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(federatedGraphSchema.getType('edfs__DeliveryGuarantees')).toBeUndefined();
    expect(federatedGraphSchema.getType('edfs__DeliveryGuaranteeMode')).toBeUndefined();
  });
});

const dgEntitySubgraph: Subgraph = {
  name: 'dg-entity',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }

    type Entity @key(fields: "id") {
      id: ID!
    }
  `),
};

function dgKafkaSubgraph(name: string, directiveArguments: string, extraDefinitions = ''): Subgraph {
  return {
    name,
    url: '',
    definitions: parse(`
      type Entity @key(fields: "id", resolvable: false) {
        id: ID! @external
      }

      type Subscription {
        entitySubscription: Entity! @edfs__kafkaSubscribe(topics: ["entities"]${directiveArguments})
      }
      ${extraDefinitions}
    `),
  };
}

const dgKafkaNone = dgKafkaSubgraph('dg-kafka-none', '');
const dgKafkaOff = dgKafkaSubgraph('dg-kafka-off', ', deliveryGuarantees: { mode: OFF }');
const dgKafkaEmpty = dgKafkaSubgraph('dg-kafka-empty', ', deliveryGuarantees: {}');
const dgKafkaNull = dgKafkaSubgraph('dg-kafka-null', ', deliveryGuarantees: null');
const dgKafkaCursor = dgKafkaSubgraph('dg-kafka-cursor', ', deliveryGuarantees: { mode: CURSOR }');
const dgKafkaNotObject = dgKafkaSubgraph('dg-kafka-not-object', ', deliveryGuarantees: CURSOR');
const dgKafkaUnknownField = dgKafkaSubgraph(
  'dg-kafka-unknown-field',
  ', deliveryGuarantees: { mode: CURSOR, unknown: 1 }',
);
const dgKafkaStringMode = dgKafkaSubgraph('dg-kafka-string-mode', ', deliveryGuarantees: { mode: "CURSOR" }');
const dgKafkaUnknownMode = dgKafkaSubgraph('dg-kafka-unknown-mode', ', deliveryGuarantees: { mode: ALWAYS }');
const dgKafkaCursorSelfDefined = dgKafkaSubgraph(
  'dg-kafka-cursor-self-defined',
  ', deliveryGuarantees: { mode: CURSOR }',
  `
    enum edfs__DeliveryGuaranteeMode {
      OFF
      CURSOR
    }

    input edfs__DeliveryGuarantees {
      mode: edfs__DeliveryGuaranteeMode! = OFF
    }
  `,
);
const dgKafkaInvalidInputDefinition = dgKafkaSubgraph(
  'dg-kafka-invalid-input-definition',
  ', deliveryGuarantees: { mode: CURSOR }',
  `
    enum edfs__DeliveryGuaranteeMode {
      OFF
      CURSOR
    }

    input edfs__DeliveryGuarantees {
      mode: edfs__DeliveryGuaranteeMode
    }
  `,
);
const dgKafkaInvalidEnumDefinition = dgKafkaSubgraph(
  'dg-kafka-invalid-enum-definition',
  ', deliveryGuarantees: { mode: CURSOR }',
  `
    enum edfs__DeliveryGuaranteeMode {
      OFF
      CURSOR
      ALWAYS
    }
  `,
);

const dgNatsCursor: Subgraph = {
  name: 'dg-nats-cursor',
  url: '',
  definitions: parse(`
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
  `),
};

const dgRedisCursor: Subgraph = {
  name: 'dg-redis-cursor',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id", resolvable: false) {
      id: ID! @external
    }

    type Subscription {
      entitySubscription: Entity! @edfs__redisSubscribe(channels: ["entities"], deliveryGuarantees: { mode: CURSOR })
    }
  `),
};
