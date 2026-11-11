import { type Kind } from 'graphql';
import { type ArgumentName, type SubgraphName } from '../types/types';

export type RootTypeName = 'Mutation' | 'Query' | 'Subscription';

export type InvalidArgumentImplementation = {
  actualType: string;
  argumentName: string;
  expectedType: string;
};

export type InvalidFieldImplementation = {
  implementationContextCoords: Set<string>;
  interfaceContextCoords: Set<string>;
  invalidAdditionalArguments: Set<ArgumentName>;
  invalidImplementedArguments: InvalidArgumentImplementation[];
  isInaccessible: boolean;
  originalResponseType: string;
  // Argument names that are not defined at all
  unimplementedArguments: Set<ArgumentName>;
  implementedResponseType?: string;
  // Argument names that are not defined in all subgraphs and are removed from the federated field definition
  unfederatedArguments?: Set<ArgumentName>;
};

export type ImplementationErrors = {
  invalidFieldImplementations: Map<string, InvalidFieldImplementation>;
  unimplementedFields: string[];
};

export type EnumUsageData = {
  inputCoordsBySubgraphName: Map<SubgraphName, Set<string>>;
  outputCoordsBySubgraphName: Map<SubgraphName, Set<string>>;
};

export type GraphFieldData = {
  externalSubgraphNames: Set<SubgraphName>;
  name: string;
  namedTypeName: string;
  isLeaf: boolean;
  subgraphNames: Set<SubgraphName>;
};

// The accumulation of all EntityInterfaceSubgraphData for the type name
export type InvalidRequiredInputValueData = {
  inputValueName: string;
  missingSubgraphs: Array<SubgraphName>;
  requiredSubgraphs: Array<SubgraphName>;
};

export type InvalidEntityInterface = {
  definedConcreteTypeNames: Set<string>;
  requiredConcreteTypeNames: Set<string>;
  subgraphName: string;
};

export type InputNodeKind = Kind.ENUM_TYPE_DEFINITION | Kind.INPUT_OBJECT_TYPE_DEFINITION | Kind.SCALAR_TYPE_DEFINITION;

export type OutputNodeKind =
  | Kind.ENUM_TYPE_DEFINITION
  | Kind.INTERFACE_TYPE_DEFINITION
  | Kind.OBJECT_TYPE_DEFINITION
  | Kind.SCALAR_TYPE_DEFINITION
  | Kind.UNION_TYPE_DEFINITION;
