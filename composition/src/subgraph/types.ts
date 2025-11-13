import { DirectiveDefinitionNode, DocumentNode, GraphQLSchema, OperationTypeNode } from 'graphql';
import { ConfigurationData } from '../router-configuration/types';
import {
  ConditionalFieldData,
  EntityInterfaceSubgraphData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
} from '../schema-building/types';
import { DirectiveName, FieldName, SubgraphName, TypeName } from '../types/types';
import { SchemaDefinitionNode, SchemaExtensionNode } from 'graphql/index';

export type Subgraph = {
  definitions: DocumentNode;
  name: SubgraphName;
  url: string;
};

export type SubgraphConfig = {
  configurationDataByTypeName: Map<TypeName, ConfigurationData>;
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  isVersionTwo: boolean;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  schema: GraphQLSchema;
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
};

export type InternalSubgraph = {
  conditionalFieldDataByCoordinates: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<TypeName, ConfigurationData>;
  definitions: DocumentNode;
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<TypeName, Set<string>>;
  name: string;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<TypeName, Set<FieldName>>;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<DirectiveName, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
  url: string;
};
