import { Kind, TypeNode } from 'graphql';
import {
  ArgumentConfiguration,
  ArgumentSource,
  EntityInterfaceConfiguration,
  EventConfiguration,
  EventType,
  FieldConfiguration,
  RequiredField,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  ArgumentConfigurationData,
  ConfigurationDataMap,
  RequiredFieldConfiguration,
  EventType as CompositionEventType,
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

export function configurationDataMapToDataSourceConfiguration(dataMap: ConfigurationDataMap): DataSourceConfiguration {
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
          type: eventType(event.type),
          typeName,
          fieldName: event.fieldName,
          topic: event.topic,
        }),
      );
    }
  }
  return output;
}

export function argumentConfigurationDatasToFieldConfigurations(
  datas: ArgumentConfigurationData[],
): FieldConfiguration[] {
  const output: FieldConfiguration[] = [];
  for (const data of datas) {
    const argumentConfigurations: ArgumentConfiguration[] = data.argumentNames.map(
      (argumentName: string) =>
        new ArgumentConfiguration({
          name: argumentName,
          sourceType: ArgumentSource.FIELD_ARGUMENT,
        }),
    );
    output.push(
      new FieldConfiguration({
        argumentsConfiguration: argumentConfigurations,
        fieldName: data.fieldName,
        typeName: data.typeName,
      }),
    );
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
