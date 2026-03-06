import { ContractName, DirectiveName, FieldName, SubgraphName, TypeName } from '../../types/types';
import {
  AuthorizationData,
  EntityData,
  EntityInterfaceFederationData,
  InputObjectDefinitionData,
  PersistedDirectivesData,
} from '../../schema-building/types';
import { ConstDirectiveNode, InputValueDefinitionNode } from 'graphql';
import { InternalSubgraph, Subgraph } from '../../subgraph/types';
import { ContractTagOptions } from '../../federation/types';
import { CompositionOptions } from '../../types/params';
import { Graph } from '../../resolvability-graph/graph';
import { Warning } from '../../warnings/types';

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
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<SubgraphName, InternalSubgraph>;
  warnings: Array<Warning>;
  options?: CompositionOptions;
};
