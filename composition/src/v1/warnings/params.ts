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
  subgraphName: SubgraphName;
  fieldCoords: FieldName;
  entityType: TypeName;
  unmappedKeyField: FieldName;
};

export type AutoMappingTypeMismatchWarningParams = {
  subgraphName: SubgraphName;
  argumentName: string;
  fieldCoords: FieldName;
  argumentType: string;
  keyField: FieldName;
  entityType: TypeName;
  keyFieldType: string;
};

export type AutoMappingAdditionalNonKeyArgumentWarningParams = {
  subgraphName: SubgraphName;
  argumentName: string;
  fieldCoords: FieldName;
  keyField: FieldName;
  entityType: TypeName;
  extraArgument: string;
};

export type AutoBatchAdditionalNonKeyArgumentWarningParams = {
  subgraphName: SubgraphName;
  fieldCoords: FieldName;
  argumentName: string;
  keyField: FieldName;
  entityType: TypeName;
  extraArgument: string;
};

export type RequestScopedSingleFieldWarningParams = {
  subgraphName: SubgraphName;
  key: string;
  fieldCoords: FieldName;
};
