import { Kind, TypeNode } from 'graphql';
import {
  ArgumentConfiguration,
  ArgumentSource,
  AuthorizationConfiguration,
  DataSourceCustomEvents,
  EngineEventConfiguration,
  EntityInterfaceConfiguration,
  EventType,
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
        new FieldCoordinates({
          fieldName: fieldCoordinates[1],
          typeName: fieldCoordinates[0],
        }),
      );
    }
    conditions.push(
      new FieldSetCondition({
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
      new RequiredField({
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
  dataByTypeName: Map<string, ConfigurationData>,
): DataSourceConfiguration {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    keys: [],
    provides: [],
    events: new DataSourceCustomEvents({ nats: [], kafka: [], redis: [] }),
    requires: [],
    entityInterfaces: [],
    interfaceObjects: [],
  };
  for (const data of dataByTypeName.values()) {
    const typeName = data.typeName;
    const fieldNames: string[] = [...data.fieldNames];
    const typeField = new TypeField({ fieldNames, typeName });
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
      const entityInterfaceConfiguration = new EntityInterfaceConfiguration({
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
            new KafkaEventConfiguration({
              engineEventConfiguration: new EngineEventConfiguration({
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
            new NatsEventConfiguration({
              engineEventConfiguration: new EngineEventConfiguration({
                fieldName: event.fieldName,
                providerId: event.providerId,
                type: eventType(event.type),
                typeName,
              }),
              subjects: event.subjects,
              ...(event.streamConfiguration
                ? {
                    streamConfiguration: new NatsStreamConfiguration({
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
            new RedisEventConfiguration({
              engineEventConfiguration: new EngineEventConfiguration({
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
        new ArgumentConfiguration({
          name: argumentName,
          sourceType: ArgumentSource.FIELD_ARGUMENT,
        }),
    );
    const fieldConfiguration = new FieldConfiguration({
      argumentsConfiguration: argumentConfigurations,
      fieldName: compositionFieldConfiguration.fieldName,
      typeName: compositionFieldConfiguration.typeName,
    });
    const requiredOrScopes =
      compositionFieldConfiguration.requiredScopes?.map(
        (andScopes: string[]) => new Scopes({ requiredAndScopes: andScopes }),
      ) || [];
    const requiredOrScopesByOr =
      compositionFieldConfiguration.requiredScopesByOR?.map(
        (andScopes: string[]) => new Scopes({ requiredAndScopes: andScopes }),
      ) || [];
    const hasRequiredOrScopes = requiredOrScopes.length > 0;
    if (compositionFieldConfiguration.requiresAuthentication || hasRequiredOrScopes) {
      fieldConfiguration.authorizationConfiguration = new AuthorizationConfiguration({
        requiresAuthentication: compositionFieldConfiguration.requiresAuthentication || hasRequiredOrScopes,
        requiredOrScopes,
        requiredOrScopesByOr,
      });
    }
    if (compositionFieldConfiguration.subscriptionFilterCondition) {
      const subscriptionFilterCondition = new SubscriptionFilterCondition();
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
      const protoAndCondition = new SubscriptionFilterCondition();
      generateSubscriptionFilterCondition(protoAndCondition, andCondition);
      protoAndConditions.push(protoAndCondition);
    }
    protoMessage.and = protoAndConditions;
    return;
  }
  if (condition.in !== undefined) {
    protoMessage.in = new SubscriptionFieldCondition({
      fieldPath: condition.in.fieldPath,
      json: JSON.stringify(condition.in.values),
    });
    return;
  }
  if (condition.not !== undefined) {
    protoMessage.not = new SubscriptionFilterCondition();
    generateSubscriptionFilterCondition(protoMessage.not, condition.not);
    return;
  }
  if (condition.or !== undefined) {
    const protoOrConditions: SubscriptionFilterCondition[] = [];
    for (const orCondition of condition.or) {
      const protoOrCondition = new SubscriptionFilterCondition();
      generateSubscriptionFilterCondition(protoOrCondition, orCondition);
      protoOrConditions.push(protoOrCondition);
    }
    protoMessage.or = protoOrConditions;
    return;
  }
  throw new Error('Fatal: Incoming SubscriptionCondition object was malformed.');
}
