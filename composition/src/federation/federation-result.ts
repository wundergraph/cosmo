import { DocumentNode, GraphQLSchema } from 'graphql';

export type FederationResult = {
  errors?: Error[];
  federatedGraphAST?: DocumentNode;
  federatedGraphSchema?: GraphQLSchema;
}