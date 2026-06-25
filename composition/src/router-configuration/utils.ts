import {
  type ConfigurationData,
  type EntityCachingConfiguration,
  type FieldSetConditionData,
  type FieldSetConditionDataParams,
} from './types';
import { type FieldName, TypeName } from '../types/types';

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
      cacheInvalidateConfigurations: [],
      cachePopulateConfigurations: [],
      entityCacheConfigurations: [],
      queryCacheConfigurations: [],
    };
  }

  return configurationData.entityCaching;
}

export function newConfigurationData(isEntity: boolean, renamedTypeName: TypeName): ConfigurationData {
  return {
    fieldNames: new Set<FieldName>(),
    isRootNode: isEntity,
    typeName: renamedTypeName,
  };
}
