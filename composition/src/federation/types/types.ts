import { type Warning } from '../../warnings/types';
import {
  type ConstDirectiveNode,
  type DirectiveDefinitionNode,
  type DocumentNode,
  type GraphQLSchema,
  type StringValueNode,
} from 'graphql';
import {
  type ConfigureDescriptionData,
  type ExtensionType,
  type FederatedDirectivesData,
  type ParentDefinitionData,
} from '../../schema-building/types/types';
import { type FieldConfiguration } from '../../router-configuration/types';
import { type SubgraphConfig } from '../../subgraph/types';
import type { DirectiveName, SubgraphName, TypeName } from '../../types/types';
import { type ExecutionMultiFailure, type ExecutionSuccess } from '../../types/results';

export interface FederationFailure extends ExecutionMultiFailure {
  errors: Array<Error>;
  warnings: Array<Warning>;
}

export interface FederationSuccess extends ExecutionSuccess {
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  fieldConfigurations: Array<FieldConfiguration>;
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  subgraphConfigBySubgraphName: Map<SubgraphName, SubgraphConfig>;
  shouldIncludeClientSchema?: boolean;
  warnings: Array<Warning>;
}

export type FederationResult = FederationFailure | FederationSuccess;

export interface FederationResultWithContractsFailure extends ExecutionMultiFailure {
  errors: Array<Error>;
  warnings: Array<Warning>;
}

export interface FederationResultWithContractsSuccess extends ExecutionSuccess {
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  fieldConfigurations: Array<FieldConfiguration>;
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  federationResultByContractName: Map<string, FederationResult>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  subgraphConfigBySubgraphName: Map<SubgraphName, SubgraphConfig>;
  warnings: Array<Warning>;
  shouldIncludeClientSchema?: boolean;
}

export type FederationResultWithContracts = FederationResultWithContractsFailure | FederationResultWithContractsSuccess;

export type ContractTagOptions = {
  tagNamesToExclude: Set<string>;
  tagNamesToInclude: Set<string>;
};

export type MutualParentDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<SubgraphName, ConfigureDescriptionData>;
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  extensionType: ExtensionType;
  name: TypeName;
  federatedDirectivesData: FederatedDirectivesData;
  description?: StringValueNode;
};
