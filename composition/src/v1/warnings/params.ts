import { type FieldName, type SubgraphName, type TypeName } from '../../types/types';

export type SingleSubgraphInputFieldOneOfWarningParams = {
  fieldName: FieldName;
  subgraphName: SubgraphName;
  typeName: TypeName;
};

export type SingleFederatedInputFieldOneOfWarningParams = {
  fieldName: FieldName;
  typeName: TypeName;
};

export type IncompleteQueryCacheKeyMappingWarningParams = {
  subgraphName: string;
  fieldCoords: string;
  entityType: string;
  unmappedKeyField: string;
};

export type AutoMappingTypeMismatchWarningParams = {
  subgraphName: string;
  argumentName: string;
  fieldCoords: string;
  argumentType: string;
  keyField: string;
  entityType: string;
  keyFieldType: string;
};

export type AutoMappingAdditionalNonKeyArgumentWarningParams = {
  subgraphName: string;
  argumentName: string;
  fieldCoords: string;
  keyField: string;
  entityType: string;
  extraArgument: string;
};

export type AutoBatchAdditionalNonKeyArgumentWarningParams = {
  subgraphName: string;
  fieldCoords: string;
  argumentName: string;
  keyField: string;
  entityType: string;
  extraArgument: string;
};

export type RequestScopedSingleFieldWarningParams = {
  subgraphName: string;
  key: string;
  fieldCoords: string;
};
