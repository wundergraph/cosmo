import { type StringValueNode, type TypeNode } from 'graphql';
import { type DirectiveName, type InterfaceTypeName, type TypeName } from '../../types/types';
import {
  type EnumValueData,
  type FieldData,
  type InputValueData,
  type NodeData,
  type ParentDefinitionData,
} from './types';
import type { MutableInputValueNode } from '../ast';
import { type DirectiveArgumentData, type DirectiveDefinitionData } from '../../directive-definition-data/types/types';

export type IsTypeValidImplementationParams = {
  concreteTypeNamesByAbstractTypeName: Map<TypeName, Set<TypeName>>;
  implementationType: TypeNode;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  originalType: TypeNode;
};

export type GetRouterFederatedDirectiveNodesParams = {
  data: NodeData;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
};

export type GetValidArgumentNodesParams = {
  data: DirectiveDefinitionData;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
};

export type DirectiveDefinitionNodeFromDataParams = {
  data: DirectiveDefinitionData;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
};

export type SanitizeDefaultValueParams = {
  data: DirectiveArgumentData | InputValueData;
  namedTypeData: ParentDefinitionData;
  node?: MutableInputValueNode;
};

export type RouterSchemaFieldNodeFromDataParams = {
  argumentNodes: Array<MutableInputValueNode>;
  data: FieldData;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  description?: StringValueNode;
};

export type RouterSchemaInputValueNodeFromDataParams = {
  data: DirectiveArgumentData | InputValueData;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  description?: StringValueNode;
};

export type RouterSchemaNodeFromDataParams = {
  data: EnumValueData | ParentDefinitionData;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  description?: StringValueNode;
};

export type CompareAndValidateInputDefaultValuesParams = {
  existingData: DirectiveArgumentData | InputValueData;
  incomingData: DirectiveArgumentData | InputValueData;
};
