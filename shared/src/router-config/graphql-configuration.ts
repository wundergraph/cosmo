import { Kind, TypeNode } from 'graphql';
import {
  ArgumentConfiguration,
  ArgumentSource,
  EventConfiguration,
  EventType,
  FieldConfiguration,
  HTTPOperationConfiguration,
  RequiredField,
  TypeField,
  HTTPObjMap,
  HTTPObjMapValue,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  ArgumentConfigurationData,
  ConfigurationDataMap,
  RequiredFieldConfiguration,
  EventType as CompositionEventType,
  HttpObjMap,
  HttpConfiguration,
} from '@wundergraph/composition';

export type DataSourceConfiguration = {
  rootNodes: TypeField[];
  childNodes: TypeField[];
  provides: RequiredField[];
  events: EventConfiguration[];
  httpConfiguration?: HttpConfiguration;
  httpOperations: HTTPOperationConfiguration[];
  keys: RequiredField[];
  requires: RequiredField[];
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

function convertObjMapValue(objMap: HttpObjMap): HTTPObjMapValue {
  const output = new HTTPObjMapValue();
  for (const [key, value] of Object.entries(objMap)) {
    const mapValue = new HTTPObjMapValue({
      stringValue: typeof value === 'string' ? value : undefined,
      mapValues: typeof value === 'object' ? convertObjMapValue(value).mapValues : undefined,
    });
    output.mapValues[key] = mapValue;
  }
  return output;
}

export function convertObjMap(objMap?: HttpObjMap): HTTPObjMap {
  const output = new HTTPObjMap();
  if (objMap) {
    for (const [key, value] of Object.entries(objMap)) {
      const mapValue = new HTTPObjMapValue({
        stringValue: typeof value === 'string' ? value : undefined,
        mapValues: typeof value === 'object' ? convertObjMapValue(value).mapValues : undefined,
      });
      output.values[key] = mapValue;
    }
  }
  return output;
}

export function configurationDataMapToDataSourceConfiguration(dataMap: ConfigurationDataMap): DataSourceConfiguration {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    keys: [],
    provides: [],
    events: [],
    httpOperations: [],
    requires: [],
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

    if (!output.httpConfiguration && data.httpConfiguration) {
      output.httpConfiguration = data.httpConfiguration;
    }

    for (const operation of data.httpOperations ?? []) {
      output.httpOperations.push(
        new HTTPOperationConfiguration({
          typeName,
          fieldName: operation.fieldName,
          path: operation.path,
          operationSpecificHeaders: convertObjMap(operation.operationSpecificHeaders),
          httpMethod: operation.httpMethod || 'GET',
          isBinary: operation.isBinary ?? false,
          requestBaseBody: convertObjMap(operation.requestBaseBody),
          queryParamArgMap: convertObjMap(operation.queryParamArgMap),
          queryStringOptionsByParam: convertObjMap(operation.queryStringOptionsByParam),
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
