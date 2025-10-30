import { DirectiveName, FieldName } from '../../types/types';
import { InputObjectDefinitionData, PersistedDirectivesData } from '../../schema-building/types';
import { InputValueDefinitionNode } from 'graphql';
import { ConstDirectiveNode } from 'graphql/index';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  inputValueNodes: Array<InputValueDefinitionNode>;
  requiredFieldNames: Set<FieldName>;
};

export type ExtractPersistedDirectivesParams = {
  data: PersistedDirectivesData;
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
};
