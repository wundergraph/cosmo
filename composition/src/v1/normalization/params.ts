import type { DirectiveName, FieldName } from '../../types/types';
import type { CompositeOutputData, InputObjectDefinitionData } from '../../schema-building/types';
import type { ConstDirectiveNode } from 'graphql';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  requiredFieldNames: Set<FieldName>;
};

export type HandleFieldInheritableDirectivesParams = {
  directivesByDirectiveName: Map<DirectiveName, ConstDirectiveNode[]>;
  fieldName: FieldName;
  inheritedDirectiveNames: Set<DirectiveName>;
  parentData: CompositeOutputData;
};
