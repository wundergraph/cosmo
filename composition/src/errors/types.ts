import { FieldData, InputValueData, ParentDefinitionData } from '../schema-building/types';

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
