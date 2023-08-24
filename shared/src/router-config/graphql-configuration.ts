import { Kind, TypeNode } from 'graphql';
import {
  ArgumentConfiguration,
  ArgumentSource,
  FieldConfiguration,
  RequiredField,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { ArgumentConfigurationData, ConfigurationDataMap } from '@wundergraph/composition';

export type DataSourceConfiguration = {
  rootNodes: TypeField[];
  childNodes: TypeField[];
  requiredFields: RequiredField[];
};

export function configurationDataMapToDataSourceConfiguration(dataMap: ConfigurationDataMap) {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    requiredFields: [],
  };
  for (const [typeName, data] of dataMap) {
    const fieldNames: string[] = [...data.fieldNames];
    const typeField = new TypeField({ typeName, fieldNames });
    if (data.isRootNode) {
      output.rootNodes.push(typeField);
    } else {
      output.childNodes.push(typeField);
    }
    for (const selectionSet of data.selectionSets) {
      output.requiredFields.push(new RequiredField({ typeName, fieldName: '', selectionSet }));
    }
  }
  return output;
}

export function argumentConfigurationDatasToFieldConfigurations(datas: ArgumentConfigurationData[]): FieldConfiguration[] {
  const output: FieldConfiguration[] = [];
  for (const data of datas) {
    const argumentConfigurations: ArgumentConfiguration[] = data.argumentNames.map((argumentName) => new ArgumentConfiguration({
      name: argumentName,
      sourceType: ArgumentSource.FIELD_ARGUMENT,
    }));
    output.push(new FieldConfiguration({
      argumentsConfiguration: argumentConfigurations,
      fieldName: data.fieldName,
      typeName: data.typeName,
    }));
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
