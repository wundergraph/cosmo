import { ConfigurationData, FieldSetConditionData, FieldSetConditionDataParams } from './types';

export function newFieldSetConditionData({
  fieldCoordinatesPath,
  fieldPath,
}: FieldSetConditionDataParams): FieldSetConditionData {
  return {
    fieldCoordinatesPath,
    fieldPath,
  };
}

export function newConfigurationData(isEntity: boolean, renamedTypeName: string): ConfigurationData {
  return {
    fieldNames: new Set<string>(),
    isRootNode: isEntity,
    typeName: renamedTypeName,
  };
}
