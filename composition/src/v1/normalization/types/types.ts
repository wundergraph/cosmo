import {
  type CompositeOutputData,
  type FieldData,
  type InputObjectDefinitionData,
  type InputValueData,
  type NodeData,
  type SchemaData,
} from '../../../schema-building/types/types';
import {
  type ConstDirectiveNode,
  type DocumentNode,
  type InputValueDefinitionNode,
  type Kind,
  type Location,
  type NameNode,
  type StringValueNode,
  type ValueNode,
} from 'graphql';
import { type RequiredFieldConfiguration } from '../../../router-configuration/types';
import {
  type ArgumentName,
  type DirectiveArgumentCoords,
  type DirectiveName,
  type FieldName,
  type SubgraphName,
  type TypeName,
} from '../../../types/types';
import { type ExecutionFailure, type ExecutionSuccess } from '../../../types/results';
import {
  type DirectiveArgumentData,
  type DirectiveDefinitionData,
} from '../../../directive-definition-data/types/types';

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

export type ExtractDirectiveArgumentDataResult = {
  argumentDataByName: Map<ArgumentName, DirectiveArgumentData>;
  optionalArgumentNames: Set<ArgumentName>;
  requiredArgumentNames: Set<ArgumentName>;
};

export type ValidateDirectiveParams = {
  data: NodeData | SchemaData;
  definitionData: DirectiveDefinitionData;
  directiveCoords: string;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
  requiredArgumentNames: Array<ArgumentName>;
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

export type HandleCostDirectiveParams = {
  data: NodeData | SchemaData;
  directiveCoords: DirectiveArgumentCoords;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
};

export type HandleListSizeDirectiveParams = {
  data: FieldData;
  directiveCoords: DirectiveArgumentCoords;
  directiveNode: ConstDirectiveNode;
  errorMessages: Array<string>;
};

export type RecordDirectiveWeightOnFieldParams = {
  data: FieldData;
  definitionData: DirectiveDefinitionData;
  directiveName: DirectiveName;
  directiveNode: ConstDirectiveNode;
};

export type AddInputValueDataByNodeParams = {
  inputValueDataByName: Map<FieldName, InputValueData>;
  isArgument: boolean;
  node: InputValueDefinitionNode;
  originalParentTypeName: TypeName;
  fieldName?: FieldName;
  renamedParentTypeName?: TypeName;
};

export interface UpsertInputObjectSuccess extends ExecutionSuccess {
  data: InputObjectDefinitionData;
}

export type UpsertInputObjectResult = ExecutionFailure | UpsertInputObjectSuccess;

export type ComposeDirectiveNode = {
  readonly arguments: ReadonlyArray<ComposeDirectiveArgumentNode>;
  readonly kind: Kind.DIRECTIVE;
  readonly name: NameNode;
  readonly loc?: Location;
};

export type ComposeDirectiveArgumentNode = {
  readonly kind: Kind.ARGUMENT;
  readonly name: NameNode;
  readonly value: StringValueNode;
  readonly loc?: Location;
};

export type LinkImportData = {
  name: DirectiveName;
  coreUrl: string;
  majorVersion: number;
  minorVersion: number;
  node?: ConstDirectiveNode;
  rename?: DirectiveName;
};
