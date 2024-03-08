import { DocumentNode, GraphQLSchema, OperationTypeNode } from 'graphql';
import { EntityInterfaceSubgraphData } from '../utils/utils';
import { ConfigurationData } from '../router-configuration/router-configuration';
import { ParentDefinitionData, PersistedDirectiveDefinitionData } from '../schema-building/type-definition-data';
import { ObjectExtensionData } from '../schema-building/type-extension-data';

export type Subgraph = {
  definitions: DocumentNode;
  name: string;
  url: string;
};

export type InternalSubgraph = {
  configurationDataByParentTypeName: Map<string, ConfigurationData>;
  definitions: DocumentNode;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  name: string;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<string, Set<string>>;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  parentExtensionDataByTypeName: Map<string, ObjectExtensionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  url: string;
};

export type SubgraphConfig = {
  configurationDataMap: Map<string, ConfigurationData>;
  schema: GraphQLSchema;
};

export function recordSubgraphName(
  subgraphName: string,
  subgraphNames: Set<string>,
  nonUniqueSubgraphNames: Set<string>,
) {
  if (!subgraphNames.has(subgraphName)) {
    subgraphNames.add(subgraphName);
    return;
  }
  nonUniqueSubgraphNames.add(subgraphName);
}
