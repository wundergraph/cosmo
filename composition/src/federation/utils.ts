import { ConstDirectiveNode, DocumentNode, GraphQLSchema } from 'graphql';
import { FieldConfiguration } from '../router-configuration/router-configuration';
import { InternalSubgraph, SubgraphConfig } from '../subgraph/subgraph';
import { DefinitionWithFieldsData, FieldData } from '../schema-building/type-definition-data';
import { AuthorizationData, EntityData, EntityInterfaceFederationData } from '../utils/utils';
import { Graph } from '../resolvability-graph/graph';
import { MutableFieldNode } from '../schema-building/ast';

export type FederationFactoryOptions = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  warnings?: string[];
};

export type FederationResultContainer = {
  errors?: Error[];
  federationResult?: FederationResult;
  warnings?: String[];
};

export type FederationResult = {
  fieldConfigurations: FieldConfiguration[];
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
  shouldIncludeClientSchema?: boolean;
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

export type ParentTagData = {
  childTagDataByChildName: Map<string, ChildTagData>;
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

export type ChildTagData = {
  name: string;
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
  clientSchemaFieldNodes: MutableFieldNode[];
};

export type SubscriptionFilterData = {
  directive: ConstDirectiveNode;
  directiveSubgraphName: string;
  fieldData: FieldData;
};
