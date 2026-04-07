import {
  type DirectiveDefinitionNode,
  type DocumentNode,
  type GraphQLSchema,
  type OperationTypeNode,
  type SchemaDefinitionNode,
  type SchemaExtensionNode,
} from 'graphql';
import { type ConfigurationData, type Costs } from '../router-configuration/types';
import {
  type ConditionalFieldData,
  type EntityInterfaceSubgraphData,
  type ParentDefinitionData,
  type PersistedDirectiveDefinitionData,
} from '../schema-building/types';
import { type DirectiveName, type FieldName, type SubgraphName, type TypeName } from '../types/types';

// Properties are sorted alphabetically, optionals are last.

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
  costs?: Costs;
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
};

export type InternalSubgraph = {
  conditionalFieldDataByCoordinates: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<TypeName, ConfigurationData>;
  definitions: DocumentNode;
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<TypeName, Set<FieldName>>;
  name: SubgraphName;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<TypeName, Set<FieldName>>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<DirectiveName, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  url: string;
  costs?: Costs;
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
};
