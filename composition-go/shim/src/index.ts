import { FieldConfiguration, federateSubgraphs as realFederateSubgraphs } from '@wundergraph/composition';
import { buildRouterConfig, normalizeURL } from '@wundergraph/cosmo-shared';
import { DocumentNode, parse, print, printSchema } from 'graphql';

export type Subgraph = {
  schema: string;
  name: string;
  url: string;
  subscription_url?: string;
  subscription_protocol?: 'ws' | 'sse' | 'sse_post';
};

export type FederatedGraph = {
  fieldConfigurations: FieldConfiguration[];
  sdl: string;
};

function createFederableSubgraph(subgraph: Subgraph) {
  let definitions: DocumentNode;
  try {
    definitions = parse(subgraph.schema);
  } catch (e: any) {
    throw new Error(`could not parse schema for Graph ${subgraph.name}: ${e}`);
  }
  return {
    definitions,
    name: subgraph.name,
    url: subgraph.url,
  };

}

export function federateSubgraphs(subgraphs: Subgraph[]): FederatedGraph {
  const { federationResult, errors } = realFederateSubgraphs(subgraphs.map(createFederableSubgraph));
  if (errors && errors.length > 0) {
    throw new Error(`could not federate schema: ${errors.map((e: Error) => e.message).join(', ')}`);
  }
  return {
    fieldConfigurations: federationResult!.fieldConfigurations,
    sdl: print(federationResult!.federatedGraphAST),
  };
}

export function buildRouterConfiguration(subgraphs: Subgraph[]): string {
  const result = realFederateSubgraphs(subgraphs.map(createFederableSubgraph));
  if (result.errors && result.errors.length > 0) {
    throw new Error(`could not federate schema: ${result.errors.map((e: Error) => e.message).join(', ')}`);
  }
  if (result.federationResult === undefined) {
    throw new Error(`could not federate subgraphs`);
  }
  const config = buildRouterConfig({
    fieldConfigurations: result.federationResult.fieldConfigurations,
    federatedSDL: printSchema(result.federationResult.federatedGraphSchema),
    schemaVersionId: '',
    subgraphs: subgraphs.map((s, index) => {
      const subgraphConfig = result.federationResult!.subgraphConfigBySubgraphName.get(s.name);
      const schema = subgraphConfig?.schema;
      const configurationDataMap = subgraphConfig?.configurationDataMap;
      return {
        id: `${index}`,
        name: s.name,
        url: normalizeURL(s.url),
        sdl: s.schema,
        subscriptionUrl: normalizeURL(s.subscription_url ?? s.url),
        subscriptionProtocol: s.subscription_protocol ?? 'ws',
        schema,
        configurationDataMap,
      };
    }),
  });
  return config.toJsonString();
}
