import {
  type ArgumentName,
  type Directive,
  type DirectiveLocation,
  type DirectiveName,
  type SubgraphName,
} from '../../types/types';
import { type ConfigureDescriptionData } from '../../schema-building/types/types';
import {
  type ConstDirectiveNode,
  type ConstValueNode,
  type DirectiveDefinitionNode,
  type InputValueDefinitionNode,
  type Kind,
  type StringValueNode,
} from 'graphql/';
import { type InputNodeKind } from '../../utils/types';
import type { MutableInputValueNode, MutableTypeNode } from '../../schema-building/ast';
import { type DirectiveArgumentData, type DirectiveDefinitionData } from './types';

export type UpsertFederatedDirectiveDataParams = {
  executableDirectiveDatasByName: Map<DirectiveName, Array<DirectiveDefinitionData>>;
  existingDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  incomingDataByName: Map<DirectiveName, DirectiveDefinitionData>;
};

export type AddDirectiveArgumentDataByNodeParams = {
  directiveName: DirectiveName;
  node: InputValueDefinitionNode;
  optionalArgumentNames: Set<ArgumentName>;
  requiredArgumentNames: Set<ArgumentName>;
};

export type DirectiveArgumentDataParams = {
  directive: Directive;
  name: ArgumentName;
  namedTypeKind: InputNodeKind | Kind.NULL;
  typeNode: MutableTypeNode;
  configureDescriptionDataBySubgraphName?: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByName?: Map<DirectiveName, Array<ConstDirectiveNode>>;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
  node?: MutableInputValueNode;
  requiredSubgraphNames?: Set<SubgraphName>;
  subgraphNames?: Set<SubgraphName>;
};

export type DirectiveDefinitionDataParams = {
  locations: Set<DirectiveLocation>;
  name: DirectiveName;
  node: DirectiveDefinitionNode;
  // configureDescriptionDataBySubgraphName?: Map<SubgraphName, ConfigureDescriptionData>;
  argumentDataByName?: Map<ArgumentName, DirectiveArgumentData>;
  description?: StringValueNode;
  isComposed?: boolean;
  isRepeatable?: boolean;
  optionalArgumentNames?: Set<ArgumentName>;
  requiredArgumentNames?: Set<ArgumentName>;
  subgraphNames?: Set<SubgraphName>;
};

export type ExtractDirectiveArgumentDataParams = {
  directiveName: DirectiveName;
  errorMessages: Array<string>;
  argumentNodes?: ReadonlyArray<InputValueDefinitionNode> | Array<InputValueDefinitionNode>;
};
