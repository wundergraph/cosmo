import { DocumentNode, GraphQLSchema, OperationTypeNode } from 'graphql';
import { ConfigurationData } from '../router-configuration/types';
import {
  ConditionalFieldData,
  EntityInterfaceSubgraphData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
} from '../schema-building/types';

export type Subgraph = {
  definitions: DocumentNode;
  name: string;
  url: string;
};

export type SubgraphConfig = {
  configurationDataByTypeName: Map<string, ConfigurationData>;
  isVersionTwo: boolean;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  schema: GraphQLSchema;
};

export type InternalSubgraph = {
  conditionalFieldDataByCoordinates: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<string, ConfigurationData>;
  definitions: DocumentNode;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  name: string;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<string, Set<string>>;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  url: string;
};
