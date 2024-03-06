import { DocumentNode, GraphQLSchema } from 'graphql';
import { FieldConfiguration } from '../router-configuration/router-configuration';
import { SubgraphConfig } from '../subgraph/subgraph';

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
};

export type RootTypeFieldData = {
  fieldName: string;
  fieldTypeNodeString: string;
  path: string;
  typeName: string;
  subgraphs: Set<string>;
};
