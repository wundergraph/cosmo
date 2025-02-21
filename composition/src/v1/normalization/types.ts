import {
  ArgumentData,
  CompositeOutputData,
  DirectiveDefinitionData,
  FieldData,
  NodeData,
  SchemaData,
} from '../../schema-building/types';
import { ConstDirectiveNode, DocumentNode, ValueNode } from 'graphql';
import { RequiredFieldConfiguration } from '../../router-configuration/types';

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

export type InputValidationContainer = {
  hasUnhandledError: boolean;
  typeString: string;
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
  targetSubgraphName: string;
};

export type HandleRequiresScopesDirectiveParams = {
  directiveCoords: string;
  orScopes: ReadonlyArray<ValueNode>;
  requiredScopes: Array<Set<string>>;
};
