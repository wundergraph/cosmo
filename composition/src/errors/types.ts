import { FieldData, InputValueData, ParentDefinitionData } from '../schema-building/types';
import { FieldName, SubgraphName, TypeName } from '../types/types';

export type InvalidRootTypeFieldEventsDirectiveData = {
  definesDirectives: boolean;
  invalidDirectiveNames: Array<string>;
};

export type IncompatibleMergedTypesErrorParams = {
  actualType: string;
  expectedType: string;
  coords: string;
  isArgument?: boolean;
};

export type InvalidNamedTypeErrorParams = {
  data: FieldData | InputValueData;
  namedTypeData: ParentDefinitionData;
  nodeType: string;
};

export type SemanticNonNullLevelsIndexOutOfBoundsErrorParams = {
  maxIndex: number;
  typeString: string;
  value: string;
};

export type SemanticNonNullLevelsNonNullErrorParams = {
  typeString: string;
  value: string;
};

export type OneOfRequiredFieldsErrorParams = {
  requiredFieldNames: Array<FieldName>;
  typeName: TypeName;
};

export type IncompatibleParentTypeMergeErrorParams = {
  existingData: ParentDefinitionData;
  incomingSubgraphName: SubgraphName;
  incomingNodeType?: string;
};

export type IncompatibleTypeWithProvidesErrorMessageParams = {
  fieldCoords: string;
  responseType: TypeName;
  subgraphName: SubgraphName;
};

export type NonExternalConditionalFieldErrorParams = {
  directiveCoords: string;
  fieldSet: string;
  directiveName: string;
  subgraphName: SubgraphName;
  targetCoords: string;
};
