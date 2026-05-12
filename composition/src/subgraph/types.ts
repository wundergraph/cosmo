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
} from '../schema-building/types/types';
import {
  type AbstractTypeName,
  type DirectiveName,
  type FieldName,
  type SubgraphName,
  type TypeName,
} from '../types/types';
import { type DirectiveDefinitionData } from '../directive-definition-data/types/types';

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
  conditionalFieldDataByCoords: Map<string, ConditionalFieldData>;
  configurationDataByTypeName: Map<TypeName, ConfigurationData>;
  definitions: DocumentNode;
  directiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>;
  entityInterfaceSubgraphDataByTypeName: Map<AbstractTypeName, EntityInterfaceSubgraphData>;
  federatedDirectiveDataByName: Map<DirectiveName, DirectiveDefinitionData>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<TypeName, Set<FieldName>>;
  name: SubgraphName;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<TypeName, Set<FieldName>>;
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>;
  schema: GraphQLSchema;
  costs?: Costs;
  schemaNode?: SchemaDefinitionNode | SchemaExtensionNode;
};
