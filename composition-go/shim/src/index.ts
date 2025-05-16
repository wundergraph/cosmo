import {
  federateSubgraphs as realFederateSubgraphs,
  FieldConfiguration,
  LATEST_ROUTER_COMPATIBILITY_VERSION,
} from '@wundergraph/composition';
import {
  buildRouterConfig,
  normalizeURL,
  SubgraphKind,
  SubscriptionProtocol,
  WebsocketSubprotocol,
} from '@wundergraph/cosmo-shared';
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
  const result = realFederateSubgraphs(subgraphs.map(createFederableSubgraph), LATEST_ROUTER_COMPATIBILITY_VERSION);
  if (!result.success) {
    throw new Error(`could not federate schema: ${result.errors.map((e: Error) => e.message).join(', ')}`);
  }
  return {
    fieldConfigurations: result.fieldConfigurations,
    sdl: print(result.federatedGraphAST),
  };
}

export function buildRouterConfiguration(subgraphs: Subgraph[]): string {
  const result = realFederateSubgraphs(subgraphs.map(createFederableSubgraph), LATEST_ROUTER_COMPATIBILITY_VERSION);
  if (!result.success) {
    throw new Error(`could not federate schema: ${result.errors.map((e: Error) => e.message).join(', ')}`);
  }
  const config = buildRouterConfig({
    federatedClientSDL: printSchema(result.federatedGraphClientSchema),
    federatedSDL: printSchema(result.federatedGraphSchema),
    fieldConfigurations: result.fieldConfigurations,
    routerCompatibilityVersion: LATEST_ROUTER_COMPATIBILITY_VERSION,
    schemaVersionId: '',
    subgraphs: subgraphs.map((s, index) => {
      const subgraphConfig = result.subgraphConfigBySubgraphName.get(s.name);
      const schema = subgraphConfig?.schema;
      const configurationDataByTypeName = subgraphConfig?.configurationDataByTypeName;
      return {
        kind: SubgraphKind.Standard,
        id: `${index}`,
        name: s.name,
        url: normalizeURL(s.url),
        sdl: s.schema,
        subscriptionUrl: normalizeURL(s.subscription_url ?? s.url),
        subscriptionProtocol: s.subscription_protocol ?? 'ws',
        websocketSubprotocol: s.subscription_protocol === 'ws' ? s.websocketSubprotocol || 'auto' : undefined,
        schema,
        configurationDataByTypeName,
      };
    }),
  });
  return config.toJsonString();
}
