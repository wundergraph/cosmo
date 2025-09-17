import { FieldData, InputValueData, ParentDefinitionData } from '../schema-building/types';
import { FieldName, TypeName } from '../types/types';

export type InvalidRootTypeFieldEventsDirectiveData = {
  definesDirectives: boolean;
  invalidDirectiveNames: string[];
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
