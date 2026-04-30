import {
  type ArgumentName,
  type DirectiveLocation,
  type DirectiveName,
  type SubgraphName,
  type TypeName,
} from '../../types/types';
import type { ConstDirectiveNode, ConstValueNode, DirectiveDefinitionNode, Kind, StringValueNode } from 'graphql';
import type { InputNodeKind } from '../../utils/types';
import type { MutableInputValueNode, MutableTypeNode } from '../../schema-building/ast';
import { type ConfigureDescriptionData, type FederatedDirectivesData } from '../../schema-building/types/types';

export type DirectiveArgumentData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  federatedCoords: string;
  originalCoords: string;
  includeDefaultValue: boolean;
  kind: Kind.ARGUMENT;
  name: ArgumentName;
  namedTypeKind: InputNodeKind | Kind.NULL;
  namedTypeName: TypeName;
  node: MutableInputValueNode;
  federatedDirectivesData: FederatedDirectivesData;
  requiredSubgraphNames: Set<SubgraphName>;
  subgraphNames: Set<SubgraphName>;
  type: MutableTypeNode;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
};

export type DirectiveDefinitionData = {
  argumentDataByName: Map<ArgumentName, DirectiveArgumentData>;
  executableLocations: Set<DirectiveLocation>;
  isComposed: boolean;
  isReferenced: boolean;
  isRepeatable: boolean;
  locations: Set<DirectiveLocation>;
  majorVersion: number;
  minorVersion: number;
  name: DirectiveName;
  node: DirectiveDefinitionNode;
  // required arguments with a default value are considered optional
  optionalArgumentNames: Set<ArgumentName>;
  requiredArgumentNames: Set<ArgumentName>;
  subgraphNames: Set<SubgraphName>;
  description?: StringValueNode;
};
