import { Kind, TypeNode } from 'graphql';
import { create } from '@bufbuild/protobuf';

import {
  ArgumentConfigurationSchema,
  ArgumentSource,
  AuthorizationConfigurationSchema,
  DataSourceCustomEventsSchema,
  EngineEventConfigurationSchema,
  EntityInterfaceConfigurationSchema,
  EventType,
  FieldConfigurationSchema,
  FieldCoordinatesSchema,
  FieldSetConditionSchema,
  KafkaEventConfigurationSchema,
  NatsEventConfigurationSchema,
  NatsStreamConfigurationSchema,
  RedisEventConfigurationSchema,
  RequiredFieldSchema,
  ScopesSchema,
  SubscriptionFieldConditionSchema,
  SubscriptionFilterConditionSchema,
  TypeFieldSchema,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';

import type {
  ArgumentConfiguration,
  AuthorizationConfiguration,
  DataSourceCustomEvents,
  EngineEventConfiguration,
  EntityInterfaceConfiguration,
  FieldConfiguration,
  FieldCoordinates,
  FieldSetCondition,
  KafkaEventConfiguration,
  NatsEventConfiguration,
  NatsStreamConfiguration,
  RedisEventConfiguration,
  RequiredField,
  Scopes,
  SubscriptionFieldCondition,
  SubscriptionFilterCondition,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';

import {
  ConfigurationData,
  FieldConfiguration as CompositionFieldConfiguration,
  NatsEventType as CompositionEventType,
  PROVIDER_TYPE_KAFKA,
  PROVIDER_TYPE_NATS,
  PROVIDER_TYPE_REDIS,
  RequiredFieldConfiguration,
  SubscriptionCondition,
  TypeName,
} from '@wundergraph/composition';

export type DataSourceConfiguration = {
  rootNodes: TypeField[];
  childNodes: TypeField[];
  provides: RequiredField[];
  events: DataSourceCustomEvents;
  keys: RequiredField[];
  requires: RequiredField[];
  entityInterfaces: EntityInterfaceConfiguration[];
  interfaceObjects: EntityInterfaceConfiguration[];
};

function generateFieldSetConditions(requiredField: RequiredFieldConfiguration): Array<FieldSetCondition> | undefined {
  if (!requiredField.conditions) {
    return;
  }
  const conditions: Array<FieldSetCondition> = [];
  for (const fieldSetCondition of requiredField.conditions) {
    const fieldCoordinatesPath: Array<FieldCoordinates> = [];
    for (const path of fieldSetCondition.fieldCoordinatesPath) {
      const fieldCoordinates = path.split('.');
      if (fieldCoordinates.length !== 2) {
        throw new Error(
          `fatal: malformed conditional field coordinates "${path}" for field set "${requiredField.selectionSet}".`,
        );
      }
      fieldCoordinatesPath.push(
        create(FieldCoordinatesSchema, {
          fieldName: fieldCoordinates[1],
          typeName: fieldCoordinates[0],
        }),
      );
    }
    conditions.push(
      create(FieldSetConditionSchema, {
        fieldCoordinatesPath,
        fieldPath: fieldSetCondition.fieldPath,
      }),
    );
  }
  return conditions;
}

export function addRequiredFields(
  requiredFields: Array<RequiredFieldConfiguration> | undefined,
  target: Array<RequiredField>,
  typeName: string,
) {
  if (!requiredFields) {
    return;
  }
  for (const requiredField of requiredFields) {
    const conditions = generateFieldSetConditions(requiredField);
    target.push(
      create(RequiredFieldSchema, {
        typeName,
        fieldName: requiredField.fieldName,
        selectionSet: requiredField.selectionSet,
        ...(requiredField.disableEntityResolver ? { disableEntityResolver: true } : {}),
        ...(conditions ? { conditions } : {}),
      }),
    );
  }
}

function eventType(type: CompositionEventType) {
  switch (type) {
    case 'publish': {
      return EventType.PUBLISH;
    }
    case 'request': {
      return EventType.REQUEST;
    }
    case 'subscribe': {
      return EventType.SUBSCRIBE;
    }
  }
}

export function configurationDatasToDataSourceConfiguration(
  dataByTypeName: Map<TypeName, ConfigurationData>,
): DataSourceConfiguration {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    keys: [],
    provides: [],
    events: create(DataSourceCustomEventsSchema, { nats: [], kafka: [], redis: [] }),
    requires: [],
    entityInterfaces: [],
    interfaceObjects: [],
  };
  for (const data of dataByTypeName.values()) {
    const typeName = data.typeName;
    const fieldNames: string[] = [...data.fieldNames];
    const typeField = create(TypeFieldSchema, { fieldNames, typeName });
    if (data.externalFieldNames && data.externalFieldNames.size > 0) {
      typeField.externalFieldNames = [...data.externalFieldNames];
    }
    if (data.requireFetchReasonsFieldNames && data.requireFetchReasonsFieldNames.length > 0) {
      typeField.requireFetchReasonsFieldNames = [...data.requireFetchReasonsFieldNames];
    }
    if (data.isRootNode) {
      output.rootNodes.push(typeField);
    } else {
      output.childNodes.push(typeField);
    }
    if (data.entityInterfaceConcreteTypeNames) {
      const entityInterfaceConfiguration = create(EntityInterfaceConfigurationSchema, {
        interfaceTypeName: typeName,
        concreteTypeNames: [...data.entityInterfaceConcreteTypeNames],
      });
      data.isInterfaceObject
        ? output.interfaceObjects.push(entityInterfaceConfiguration)
        : output.entityInterfaces.push(entityInterfaceConfiguration);
    }
    addRequiredFields(data.keys, output.keys, typeName);
    addRequiredFields(data.provides, output.provides, typeName);
    addRequiredFields(data.requires, output.requires, typeName);
    const natsEventConfigurations: NatsEventConfiguration[] = [];
    const kafkaEventConfigurations: KafkaEventConfiguration[] = [];
    const redisEventConfigurations: RedisEventConfiguration[] = [];
    for (const event of data.events ?? []) {
      switch (event.providerType) {
        case PROVIDER_TYPE_KAFKA: {
          kafkaEventConfigurations.push(
            create(KafkaEventConfigurationSchema, {
              engineEventConfiguration: create(EngineEventConfigurationSchema, {
                fieldName: event.fieldName,
                providerId: event.providerId,
                type: eventType(event.type),
                typeName,
              }),
              topics: event.topics,
            }),
          );
          break;
        }
        case PROVIDER_TYPE_NATS: {
          natsEventConfigurations.push(
            create(NatsEventConfigurationSchema, {
              engineEventConfiguration: create(EngineEventConfigurationSchema, {
                fieldName: event.fieldName,
                providerId: event.providerId,
                type: eventType(event.type),
                typeName,
              }),
              subjects: event.subjects,
              ...(event.streamConfiguration
                ? {
                    streamConfiguration: create(NatsStreamConfigurationSchema, {
                      consumerInactiveThreshold: event.streamConfiguration.consumerInactiveThreshold,
                      consumerName: event.streamConfiguration.consumerName,
                      streamName: event.streamConfiguration.streamName,
                    }),
                  }
                : {}),
            }),
          );
          break;
        }
        case PROVIDER_TYPE_REDIS: {
          redisEventConfigurations.push(
            create(RedisEventConfigurationSchema, {
              engineEventConfiguration: create(EngineEventConfigurationSchema, {
                fieldName: event.fieldName,
                providerId: event.providerId,
                type: eventType(event.type),
                typeName,
              }),
              channels: event.channels,
            }),
          );
          break;
        }
        default: {
          throw new Error(`Fatal: Unknown event provider.`);
        }
      }
    }
    output.events.nats.push(...natsEventConfigurations);
    output.events.kafka.push(...kafkaEventConfigurations);
    output.events.redis.push(...redisEventConfigurations);
  }
  return output;
}

export function generateFieldConfigurations(
  fieldConfigurations: Array<CompositionFieldConfiguration>,
): Array<FieldConfiguration> {
  const output: Array<FieldConfiguration> = [];
  for (const compositionFieldConfiguration of fieldConfigurations) {
    const argumentConfigurations: ArgumentConfiguration[] = compositionFieldConfiguration.argumentNames.map(
      (argumentName: string) =>
        create(ArgumentConfigurationSchema, {
          name: argumentName,
          sourceType: ArgumentSource.FIELD_ARGUMENT,
        }),
    );
    const fieldConfiguration = create(FieldConfigurationSchema, {
      argumentsConfiguration: argumentConfigurations,
      fieldName: compositionFieldConfiguration.fieldName,
      typeName: compositionFieldConfiguration.typeName,
    });
    const requiredOrScopes =
      compositionFieldConfiguration.requiredScopes?.map((andScopes: string[]) =>
        create(ScopesSchema, { requiredAndScopes: andScopes }),
      ) || [];
    const requiredOrScopesByOr =
      compositionFieldConfiguration.requiredScopesByOR?.map((andScopes: string[]) =>
        create(ScopesSchema, { requiredAndScopes: andScopes }),
      ) || [];
    const hasRequiredOrScopes = requiredOrScopes.length > 0;
    if (compositionFieldConfiguration.requiresAuthentication || hasRequiredOrScopes) {
      fieldConfiguration.authorizationConfiguration = create(AuthorizationConfigurationSchema, {
        requiresAuthentication: compositionFieldConfiguration.requiresAuthentication || hasRequiredOrScopes,
        requiredOrScopes,
        requiredOrScopesByOr,
      });
    }
    if (compositionFieldConfiguration.subscriptionFilterCondition) {
      const subscriptionFilterCondition = create(SubscriptionFilterConditionSchema);
      generateSubscriptionFilterCondition(
        subscriptionFilterCondition,
        compositionFieldConfiguration.subscriptionFilterCondition,
      );
      fieldConfiguration.subscriptionFilterCondition = subscriptionFilterCondition;
    }
    output.push(fieldConfiguration);
  }
  return output;
}

const resolveNamedTypeName = (type: TypeNode): string => {
  switch (type.kind) {
    case Kind.NON_NULL_TYPE: {
      return resolveNamedTypeName(type.type);
    }
    case Kind.LIST_TYPE: {
      return resolveNamedTypeName(type.type);
    }
    default: {
      return type.name.value;
    }
  }
};

export function generateSubscriptionFilterCondition(
  protoMessage: SubscriptionFilterCondition,
  condition: SubscriptionCondition,
) {
  if (condition.and !== undefined) {
    const protoAndConditions: SubscriptionFilterCondition[] = [];
    for (const andCondition of condition.and) {
      const protoAndCondition = create(SubscriptionFilterConditionSchema);
      generateSubscriptionFilterCondition(protoAndCondition, andCondition);
      protoAndConditions.push(protoAndCondition);
    }
    protoMessage.and = protoAndConditions;
    return;
  }
  if (condition.in !== undefined) {
    protoMessage.in = create(SubscriptionFieldConditionSchema, {
      fieldPath: condition.in.fieldPath,
      json: JSON.stringify(condition.in.values),
    });
    return;
  }
  if (condition.not !== undefined) {
    protoMessage.not = create(SubscriptionFilterConditionSchema);
    generateSubscriptionFilterCondition(protoMessage.not, condition.not);
    return;
  }
  if (condition.or !== undefined) {
    const protoOrConditions: SubscriptionFilterCondition[] = [];
    for (const orCondition of condition.or) {
      const protoOrCondition = create(SubscriptionFilterConditionSchema);
      generateSubscriptionFilterCondition(protoOrCondition, orCondition);
      protoOrConditions.push(protoOrCondition);
    }
    protoMessage.or = protoOrConditions;
    return;
  }
  throw new Error('Fatal: Incoming SubscriptionCondition object was malformed.');
}
