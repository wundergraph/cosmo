import {
  type ConfigurationData,
  type EntityCachingConfiguration,
  type FieldSetConditionData,
  type FieldSetConditionDataParams,
} from './types';
import { type FieldName } from '../types/types';

export function newFieldSetConditionData({
  fieldCoordinatesPath,
  fieldPath,
}: FieldSetConditionDataParams): FieldSetConditionData {
  return {
    fieldCoordinatesPath,
    fieldPath,
  };
}

export function getOrInitializeEntityCaching(configurationData: ConfigurationData): EntityCachingConfiguration {
  if (!configurationData.entityCaching) {
    configurationData.entityCaching = {
      entityCacheConfigurations: [],
      cacheInvalidationConfigurations: [],
    };
  }
  return configurationData.entityCaching;
}

export function newConfigurationData(isEntity: boolean, renamedTypeName: string): ConfigurationData {
  return {
    fieldNames: new Set<FieldName>(),
    isRootNode: isEntity,
    typeName: renamedTypeName,
  };
}
