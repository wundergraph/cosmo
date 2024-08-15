import { FieldConfiguration, federateSubgraphs as realFederateSubgraphs } from '@wundergraph/composition';
import { buildRouterConfig, normalizeURL, SubscriptionProtocol, WebsocketSubprotocol } from '@wundergraph/cosmo-shared';
import { DocumentNode, parse, print, printSchema } from 'graphql';

export type Subgraph = {
  schema: string;
  name: string;
  url: string;
  subscription_url?: string;
  subscription_protocol?: SubscriptionProtocol;
  websocketSubprotocol?: WebsocketSubprotocol;
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
    federatedClientSDL: printSchema(result.federationResult.federatedGraphClientSchema),
    federatedSDL: printSchema(result.federationResult.federatedGraphSchema),
    fieldConfigurations: result.federationResult.fieldConfigurations,
    schemaVersionId: '',
    subgraphs: subgraphs.map((s, index) => {
      const subgraphConfig = result.federationResult!.subgraphConfigBySubgraphName.get(s.name);
      const schema = subgraphConfig?.schema;
      const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;
      return {
        id: `${index}`,
        name: s.name,
        url: normalizeURL(s.url),
        sdl: s.schema,
        subscriptionUrl: normalizeURL(s.subscription_url ?? s.url),
        subscriptionProtocol: s.subscription_protocol ?? 'ws',
        websocketSubprotocol: s.subscription_protocol === 'ws' ? s.websocketSubprotocol || 'auto': undefined,
        schema,
        configurationDataByTypeName,
      };
    }),
  });
  return config.toJsonString();
}
