import { ConfigurationData, FieldSetConditionData, FieldSetConditionDataParams } from './types';
import { FieldName } from '../types/types';

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
    fieldNames: new Set<FieldName>(),
    isRootNode: isEntity,
    typeName: renamedTypeName,
  };
}
