import { type DirectiveName, type FieldName, type SubgraphName, type TypeName } from '../../types/types';

export type SingleSubgraphInputFieldOneOfWarningParams = {
  fieldName: FieldName;
  subgraphName: SubgraphName;
  typeName: TypeName;
};

export type SingleFederatedInputFieldOneOfWarningParams = {
  fieldName: FieldName;
  typeName: TypeName;
};

export type InvalidRepeatedComposedDirectiveWarningParams = {
  directiveCoords: string;
  directiveName: DirectiveName;
  printedDirective: string;
};
