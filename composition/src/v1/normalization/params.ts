import type { DirectiveName, FieldName } from '../../types/types';
import type { CompositeOutputData, InputObjectDefinitionData } from '../../schema-building/types';
import type { ConstDirectiveNode } from 'graphql';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  requiredFieldNames: Set<FieldName>;
};

export type HandleFieldInheritableDirectivesParams = {
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  fieldName: FieldName;
  inheritedDirectiveNames: Set<DirectiveName>;
  parentData: CompositeOutputData;
};
