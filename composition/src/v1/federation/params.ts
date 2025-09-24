import { FieldName } from '../../types/types';
import { InputObjectDefinitionData } from '../../schema-building/types';
import { InputValueDefinitionNode } from 'graphql';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  inputValueNodes: Array<InputValueDefinitionNode>;
  requiredFieldNames: Set<FieldName>;
};
