import { DocumentNode, GraphQLSchema } from 'graphql';
import { ArgumentConfigurationData } from '../subgraph/field-configuration';

export type FederationResultContainer = {
  errors?: Error[];
  federationResult?: FederationResult;
};

export type FederationResult = {
  argumentConfigurations: ArgumentConfigurationData[];
  federatedGraphAST: DocumentNode;
  federatedGraphSchema: GraphQLSchema;
}