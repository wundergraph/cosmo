import { FieldName } from '../../types/types';
import { InputObjectDefinitionData } from '../../schema-building/types';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  requiredFieldNames: Set<FieldName>;
};
