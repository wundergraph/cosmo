import { DocumentNode, FieldDefinitionNode, GraphQLSchema, Kind } from 'graphql';
import { FieldConfiguration } from '../router-configuration/router-configuration';
import { SubgraphConfig } from '../subgraph/subgraph';
import { DefinitionWithFieldsData } from '../schema-building/type-definition-data';

export type FederationResultContainer = {
  errors?: Error[];
  federationResult?: FederationResult;
  warnings?: String[];
};

export type FederationResult = {
  fieldConfigurations: FieldConfiguration[];
  federatedGraphAST: DocumentNode;
  federatedGraphSchema: GraphQLSchema;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
  federatedGraphClientSchema: GraphQLSchema;
};

export type FederationResultContainerWithContracts = {
  errors?: Error[];
  federationResult?: FederationResult;
  federationResultContainerByContractName?: Map<string, FederationResultContainer>;
  warnings?: String[];
};

export type RootTypeFieldData = {
  fieldName: string;
  fieldTypeNodeString: string;
  path: string;
  typeName: string;
  subgraphs: Set<string>;
};

export type ParentTagDataKind =
  | Kind.ENUM_TYPE_DEFINITION
  | Kind.INPUT_OBJECT_TYPE_DEFINITION
  | Kind.INTERFACE_TYPE_DEFINITION
  | Kind.OBJECT_TYPE_DEFINITION
  | Kind.SCALAR_TYPE_DEFINITION
  | Kind.UNION_TYPE_DEFINITION;

export type ParentTagData = {
  childTagDataByChildName: Map<string, ChildTagData>;
  // kind: ParentTagDataKind;
  tagNames: Set<string>;
  typeName: string;
};

export function newParentTagData(typeName: string): ParentTagData {
  return {
    childTagDataByChildName: new Map<string, ChildTagData>(),
    tagNames: new Set<string>(),
    typeName,
  };
}

export type ChildTagDataKind = Kind.ENUM_VALUE_DEFINITION | Kind.FIELD_DEFINITION | Kind.INPUT_VALUE_DEFINITION;

export type ChildTagData = {
  name: string;
  // kind: ChildTagDataKind;
  tagNames: Set<string>;
  tagNamesByArgumentName: Map<string, Set<string>>;
};

export function newChildTagData(name: string): ChildTagData {
  return {
    name,
    tagNames: new Set<string>(),
    tagNamesByArgumentName: new Map<string, Set<string>>(),
  };
}

export type InterfaceImplementationData = {
  data: DefinitionWithFieldsData;
  clientSchemaFieldNodes: FieldDefinitionNode[];
};
