import { type NodeData, type ParentDefinitionData, type SchemaData } from '../../schema-building/types/types';
import type { ArgumentName, DirectiveName, TypeName } from '../../types/types';
import type { ConstDirectiveNode, ConstValueNode, TypeNode } from 'graphql';
import { type DirectiveArgumentData, type DirectiveDefinitionData } from '../../directive-definition-data/types/types';

export type IsArgumentValueValidParams = {
  argumentValue: ConstValueNode;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  typeNode: TypeNode;
};

export type ValidateCustomDirectiveParams = {
  argumentDataByName: Map<ArgumentName, DirectiveArgumentData>;

  directiveNode: ConstDirectiveNode;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  requiredArgumentNames: Array<ArgumentName>;
};

export type ValidateDirectivesParams = {
  data: NodeData | SchemaData;
  directiveCoords: string;
  directiveDefinitionData: DirectiveDefinitionData;
  directiveNodes: Array<ConstDirectiveNode>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
};
