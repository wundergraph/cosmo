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
  KafkaEventConfiguration,
  NatsEventConfiguration,
  NatsStreamConfiguration,
  RequiredField,
  Scopes,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  ConfigurationData,
  FieldConfiguration as CompositionFieldConfiguration,
  NatsEventType as CompositionEventType,
  RequiredFieldConfiguration,
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

function addRequiredFields(
  requiredFields: RequiredFieldConfiguration[] | undefined,
  target: RequiredField[],
  typeName: string,
) {
  if (!requiredFields) {
    return;
  }
  for (const requiredField of requiredFields) {
    target.push(
      new RequiredField({
        typeName,
        fieldName: requiredField.fieldName,
        selectionSet: requiredField.selectionSet,
        ...(requiredField.disableEntityResolver ? { disableEntityResolver: true } : {}),
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

export function configurationDataMapToDataSourceConfiguration(
  dataMap: Map<string, ConfigurationData>,
): DataSourceConfiguration {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    keys: [],
    provides: [],
    events: new DataSourceCustomEvents({ nats: [], kafka: [] }),
    requires: [],
    entityInterfaces: [],
    interfaceObjects: [],
  };
  for (const data of dataMap.values()) {
    const typeName = data.typeName;
    const fieldNames: string[] = [...data.fieldNames];
    const typeField = new TypeField({ typeName, fieldNames });
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
    for (const event of data.events ?? []) {
      switch (event.providerType) {
        case 'kafka': {
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
        case 'nats': {
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
                      consumerName: event.streamConfiguration.consumerName,
                      streamName: event.streamConfiguration.streamName,
                    }),
                  }
                : {}),
            }),
          );
          break;
        }
        default: {
          // TODO propagate this properly
          throw new Error(`Unknown event provider.`);
        }
      }
    }
    output.events.nats.push(...natsEventConfigurations);
    output.events.kafka.push(...kafkaEventConfigurations);
  }
  return output;
}

export function generateFieldConfigurations(
  fieldConfigurations: CompositionFieldConfiguration[],
): FieldConfiguration[] {
  const output: FieldConfiguration[] = [];
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
      compositionFieldConfiguration.requiredScopes?.map((andScopes) => new Scopes({ requiredAndScopes: andScopes })) ||
      [];
    const hasRequiredOrScopes = requiredOrScopes.length > 0;
    if (compositionFieldConfiguration.requiresAuthentication || hasRequiredOrScopes) {
      fieldConfiguration.authorizationConfiguration = new AuthorizationConfiguration({
        requiresAuthentication: compositionFieldConfiguration.requiresAuthentication || hasRequiredOrScopes,
        requiredOrScopes,
      });
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
