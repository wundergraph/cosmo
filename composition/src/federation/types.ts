import { Warning } from '../warnings/types';
import { ConstDirectiveNode, DocumentNode, GraphQLSchema, StringValueNode } from 'graphql';
import {
  ConfigureDescriptionData,
  ExtensionType,
  ParentDefinitionData,
  PersistedDirectivesData,
} from '../schema-building/types';
import { FieldConfiguration } from '../router-configuration/types';
import { Subgraph, SubgraphConfig } from '../subgraph/types';
import { SupportedRouterCompatibilityVersion } from '../router-compatibility-version/router-compatibility-version';
import { ContractName } from '../types/types';

export type FederationFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

export type FederationSuccess = {
  fieldConfigurations: Array<FieldConfiguration>;
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
  shouldIncludeClientSchema?: boolean;
  success: true;
  warnings: Array<Warning>;
};

export type FederationResult = FederationFailure | FederationSuccess;

export type FederationResultWithContractsFailure = {
  success: false;
  errors: Array<Error>;
  warnings: Array<Warning>;
};

export type FederationResultWithContractsSuccess = {
  fieldConfigurations: Array<FieldConfiguration>;
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  federationResultByContractName: Map<string, FederationResult>;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
  success: true;
  warnings: Array<Warning>;
  shouldIncludeClientSchema?: boolean;
};

export type FederationResultWithContracts = FederationResultWithContractsFailure | FederationResultWithContractsSuccess;

export type ContractTagOptions = {
  tagNamesToExclude: Set<string>;
  tagNamesToInclude: Set<string>;
};

export type MutualParentDefinitionData = {
  configureDescriptionDataBySubgraphName: Map<string, ConfigureDescriptionData>;
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>;
  extensionType: ExtensionType;
  name: string;
  persistedDirectivesData: PersistedDirectivesData;
  description?: StringValueNode;
};

export type FederateSubgraphsParams = {
  subgraphs: Array<Subgraph>;
  disableResolvabilityValidation?: boolean;
  version?: SupportedRouterCompatibilityVersion;
};

export type FederateSubgraphsWithContractsParams = {
  subgraphs: Array<Subgraph>;
  tagOptionsByContractName: Map<ContractName, ContractTagOptions>;
  disableResolvabilityValidation?: boolean;
  version?: SupportedRouterCompatibilityVersion;
};

export type FederateSubgraphsContractParams = {
  contractTagOptions: ContractTagOptions;
  subgraphs: Array<Subgraph>;
  disableResolvabilityValidation?: boolean;
  version?: SupportedRouterCompatibilityVersion;
};
