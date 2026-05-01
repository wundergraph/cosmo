import type {
  ArgumentName,
  ContractName,
  DirectiveName,
  FieldName,
  InterfaceTypeName,
  SubgraphName,
  TypeName,
} from '../../../types/types';
import {
  type AuthorizationData,
  type EntityData,
  type EntityInterfaceFederationData,
  type InputObjectDefinitionData,
  type FederatedDirectivesData,
} from '../../../schema-building/types/types';
import type { ConstDirectiveNode, InputValueDefinitionNode } from 'graphql';
import type { InternalSubgraph, Subgraph } from '../../../subgraph/types';
import type { ContractTagOptions } from '../../../federation/types/types';
import type { CompositionOptions } from '../../../types/params';
import type { Graph } from '../../../resolvability-graph/graph';
import type { Warning } from '../../../warnings/types';
import {
  type DirectiveArgumentData,
  type DirectiveDefinitionData,
} from '../../../directive-definition-data/types/types';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  inputValueNodes: Array<InputValueDefinitionNode>;
  requiredFieldNames: Set<FieldName>;
};

export type ExtractFederatedDirectivesParams = {
  data: FederatedDirectivesData;
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
};

export type FederationParams = {
  subgraphs: Array<Subgraph>;
  options?: CompositionOptions;
};

export type FederateSubgraphsWithContractsV1Params = {
  subgraphs: Array<Subgraph>;
  tagOptionsByContractName: Map<ContractName, ContractTagOptions>;
  options?: CompositionOptions;
};

export type FederateSubgraphsContractV1Params = {
  subgraphs: Array<Subgraph>;
  contractTagOptions: ContractTagOptions;
  options?: CompositionOptions;
};

export type FederationFactoryParams = {
  authorizationDataByParentTypeName: Map<TypeName, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<TypeName, Set<TypeName>>;
  entityDataByTypeName: Map<TypeName, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<TypeName, EntityInterfaceFederationData>;
  executableDirectiveDatasByName: Map<DirectiveName, Array<DirectiveDefinitionData>>;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  fieldCoordsByNamedTypeName: Map<TypeName, Set<string>>;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<SubgraphName, InternalSubgraph>;
  warnings: Array<Warning>;
  options?: CompositionOptions;
};

export type UpsertDirectiveArgumentDataParams = {
  argumentDataByName: Map<ArgumentName, DirectiveArgumentData>;
  incomingData: DirectiveArgumentData;
};
