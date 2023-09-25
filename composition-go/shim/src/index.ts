import { ArgumentConfigurationData, federateSubgraphs as realFederateSubgraphs } from '@wundergraph/composition';
import { DocumentNode, parse, print } from 'graphql';

export type Subgraph = {
  schema: string;
  name: string;
  url: string;
};

export type FederatedGraph = {
  argumentConfigurations: ArgumentConfigurationData[];
  sdl: string;
};

export function federateSubgraphs(subgraphs: Subgraph[]): FederatedGraph {
  const { federationResult, errors } = realFederateSubgraphs(
    subgraphs.map(({ schema, name, url }) => {
      let definitions: DocumentNode;
      try {
        definitions = parse(schema);
      } catch (e: any) {
        throw new Error(`could not parse schema for Graph ${name}: ${e}`);
      }
      return {
        definitions,
        name,
        url,
      };
    }),
  );
  if (errors && errors.length > 0) {
    throw new Error(`could not federate schema: ${errors.map((e) => e.message).join(', ')}`);
  }
  return {
    argumentConfigurations: federationResult!.argumentConfigurations,
    sdl: print(federationResult!.federatedGraphAST),
  };
}
