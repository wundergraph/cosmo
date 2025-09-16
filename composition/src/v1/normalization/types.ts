import {
  ArgumentData,
  CompositeOutputData,
  DirectiveDefinitionData,
  FieldData,
  InputValueData,
  NodeData,
  SchemaData,
} from '../../schema-building/types';
import { ConstDirectiveNode, DocumentNode, InputValueDefinitionNode, ValueNode } from 'graphql';
import { RequiredFieldConfiguration } from '../../router-configuration/types';
import { SubgraphName } from '../../types/types';

export type KeyFieldSetData = {
  documentNode: DocumentNode;
  isUnresolvable: boolean;
  normalizedFieldSet: string;
  rawFieldSet: string;
};

export type FieldSetData = {
  provides: Map<string, string>;
  requires: Map<string, string>;
};

export type ConditionalFieldSetValidationResult = {
  errorMessages: Array<string>;
  configuration?: RequiredFieldConfiguration;
};

export type FieldSetParentResult = {
  errorString?: string;
  fieldSetParentData?: CompositeOutputData;
};

export type ExtractArgumentDataResult = {
  argumentTypeNodeByArgumentName: Map<string, ArgumentData>;
  optionalArgumentNames: Set<string>;
  requiredArgumentNames: Set<string>;
};

export type ValidateDirectiveParams = {
  data: NodeData | SchemaData;
  definitionData: DirectiveDefinitionData;
  directiveCoords: string;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
  requiredArgumentNames: Array<string>;
};

export type HandleOverrideDirectiveParams = {
  data: FieldData;
  directiveCoords: string;
  errorMessages: Array<string>;
  targetSubgraphName: SubgraphName;
};

export type HandleRequiresScopesDirectiveParams = {
  directiveCoords: string;
  orScopes: ReadonlyArray<ValueNode>;
  requiredScopes: Array<Set<string>>;
};

export type HandleSemanticNonNullDirectiveParams = {
  data: FieldData;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
};

export type AddInputValueDataByNodeParams = {
  inputValueDataByName: Map<string, InputValueData>;
  isArgument: boolean;
  node: InputValueDefinitionNode;
  originalParentTypeName: string;
  fieldName?: string;
  renamedParentTypeName?: string;
};
