import { Warning } from '../warnings/types';
import { ConstDirectiveNode, DocumentNode, GraphQLSchema, StringValueNode } from 'graphql';
import {
  ConfigureDescriptionData,
  ExtensionType,
  ParentDefinitionData,
  PersistedDirectivesData,
} from '../schema-building/types';
import { FieldConfiguration } from '../router-configuration/types';
import { SubgraphConfig } from '../subgraph/types';

export type FederationResultFailure = {
  errors: Array<Error>;
  success: false;
  warnings: Array<Warning>;
};

export type FederationResultSuccess = {
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

export type FederationResult = FederationResultFailure | FederationResultSuccess;

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
