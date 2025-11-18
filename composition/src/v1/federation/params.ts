import { DirectiveName, FieldName } from '../../types/types';
import { InputObjectDefinitionData, PersistedDirectivesData } from '../../schema-building/types';
import { ConstDirectiveNode, InputValueDefinitionNode } from 'graphql';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  inputValueNodes: Array<InputValueDefinitionNode>;
  requiredFieldNames: Set<FieldName>;
};

export type ExtractPersistedDirectivesParams = {
  data: PersistedDirectivesData;
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
};
