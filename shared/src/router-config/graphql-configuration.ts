import { Kind, TypeNode } from 'graphql';
import {
  ArgumentConfiguration,
  ArgumentSource,
  AuthorizationConfiguration,
  EntityInterfaceConfiguration,
  EventConfiguration,
  EventType,
  FieldConfiguration,
  RequiredField,
  Scopes,
  StreamConfiguration,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  ConfigurationData,
  EventType as CompositionEventType,
  FieldConfiguration as CompositionFieldConfiguration,
  RequiredFieldConfiguration,
} from '@wundergraph/composition';

export type DataSourceConfiguration = {
  rootNodes: TypeField[];
  childNodes: TypeField[];
  provides: RequiredField[];
  events: EventConfiguration[];
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
  throw new Error(`Unknown event type ${type}`);
}

export function configurationDataMapToDataSourceConfiguration(
  dataMap: Map<string, ConfigurationData>,
): DataSourceConfiguration {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    keys: [],
    provides: [],
    events: [],
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
    for (const event of data.events ?? []) {
      output.events.push(
        new EventConfiguration({
          fieldName: event.fieldName,
          sourceName: event.sourceName,
          subjects: event.subjects,
          type: eventType(event.type),
          typeName,
          ...(event.streamConfiguration
            ? {
                streamConfiguration: new StreamConfiguration({
                  consumer: event.streamConfiguration.consumer,
                  steamName: event.streamConfiguration.streamName,
                }),
              }
            : {}),
        }),
      );
    }
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
