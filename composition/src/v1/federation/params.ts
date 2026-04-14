import type {
  ContractName,
  DirectiveName,
  FieldName,
  InterfaceTypeName,
  SubgraphName,
  TypeName,
} from '../../types/types';
import type {
  AuthorizationData,
  EntityData,
  EntityInterfaceFederationData,
  InputObjectDefinitionData,
  PersistedDirectivesData,
} from '../../schema-building/types';
import type { ConstDirectiveNode, InputValueDefinitionNode } from 'graphql';
import type { InternalSubgraph, Subgraph } from '../../subgraph/types';
import type { ContractTagOptions } from '../../federation/types';
import type { CompositionOptions } from '../../types/params';
import type { Graph } from '../../resolvability-graph/graph';
import type { Warning } from '../../warnings/types';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  inputValueNodes: Array<InputValueDefinitionNode>;
  requiredFieldNames: Set<FieldName>;
};

export type ExtractPersistedDirectivesParams = {
  data: PersistedDirectivesData;
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
  fieldCoordsByNamedTypeName: Map<TypeName, Set<string>>;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<SubgraphName, InternalSubgraph>;
  warnings: Array<Warning>;
  options?: CompositionOptions;
};
