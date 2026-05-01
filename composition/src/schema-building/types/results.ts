import { type ConstDirectiveNode, type DirectiveDefinitionNode } from 'graphql';
import { type MutableEnumValueNode, type MutableFieldNode, type MutableInputValueNode } from '../ast';
import { type ExecutionMultiFailure, type ExecutionSuccess } from '../../types/results';
import { type MutableParentDefinitionNode } from './types';
import { type DirectiveLocation } from '../../types/types';
import { type Warning } from '../../warnings/types';

export interface GetFederatedDirectiveNodesSuccess extends ExecutionSuccess {
  nodes: Array<ConstDirectiveNode>;
  warnings: Array<Warning>;
}

export type GetFederatedDirectiveNodesResult = ExecutionMultiFailure | GetFederatedDirectiveNodesSuccess;

export interface InputValueNodesSuccess extends ExecutionSuccess {
  nodes: Array<MutableInputValueNode>;
  warnings: Array<Warning>;
}

export type InputValueNodesResult = ExecutionMultiFailure | InputValueNodesSuccess;

export interface DirectiveDefinitionNodeSuccess extends ExecutionSuccess {
  node: DirectiveDefinitionNode;
}

export type DirectiveDefinitionNodeResult = ExecutionMultiFailure | DirectiveDefinitionNodeSuccess;

export interface RouterSchemaFieldNodeFromDataSuccess extends ExecutionSuccess {
  node: MutableFieldNode;
  warnings: Array<Warning>;
}

export type RouterSchemaFieldNodeFromDataResult = ExecutionMultiFailure | RouterSchemaFieldNodeFromDataSuccess;

export interface RouterSchemaInputValueNodeFromDataSuccess extends ExecutionSuccess {
  node: MutableInputValueNode;
  warnings: Array<Warning>;
}

export type RouterSchemaInputValueNodeFromDataResult =
  | ExecutionMultiFailure
  | RouterSchemaInputValueNodeFromDataSuccess;

export interface RouterSchemaNodeFromDataSuccess<T extends MutableParentDefinitionNode | MutableEnumValueNode>
  extends ExecutionSuccess {
  node: T;
  warnings: Array<Warning>;
}

export type RouterSchemaNodeFromDataResult<T extends MutableParentDefinitionNode | MutableEnumValueNode> =
  | ExecutionMultiFailure
  | RouterSchemaNodeFromDataSuccess<T>;

export type ExtractDirectiveLocationsResult = {
  errors: Array<Error>;
  locations: Set<DirectiveLocation>;
};
