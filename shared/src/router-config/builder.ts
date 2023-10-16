import crypto from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { ArgumentConfigurationData, normalizeSubgraphFromString } from '@wundergraph/composition';
import { GraphQLSchema, lexicographicSortSchema } from 'graphql';
import {
  ConfigurationVariable,
  ConfigurationVariableKind,
  DataSourceConfiguration,
  DataSourceKind,
  EngineConfiguration,
  HTTPMethod,
  InternedString,
  RouterConfig,
  GraphQLSubscriptionProtocol,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  argumentConfigurationDatasToFieldConfigurations,
  configurationDataMapToDataSourceConfiguration,
} from './graphql-configuration.js';

export interface Input {
  argumentConfigurations: ArgumentConfigurationData[];
  federatedSDL: string;
  subgraphs: Subgraph[];
}

/**
 * Protocol used when subscribing to a subgraph.
 *
 * ws: Negotiates an appropriate protocol over websockets. Both https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md and https://github.com/apollographql/subscriptions-transport-ws/blob/master/PROTOCOL.md are supported
 * sse: Uses the Server-Sent Events protocol with a GET request
 * sse-post: Uses the Server-Sent Events protocol with a POST request
 */
export type SubscriptionProtocol = 'ws' | 'sse' | 'sse-post';

export interface Subgraph {
  id: string;
  name: string;
  sdl: string;
  url: string;
  subscriptions?: {
    /**
     * The protocol to use for subscriptions. If not set, defaults to graphql-ws.
     */
    protocol?: SubscriptionProtocol;
  };
}

export const internString = (config: EngineConfiguration, str: string): InternedString => {
  const key = crypto.createHash('sha1').update(str).digest('hex');
  config.stringStorage[key] = str;
  return new InternedString({
    key,
  });
};

export const buildRouterConfig = function (input: Input): RouterConfig {
  const engineConfig = new EngineConfiguration({
    defaultFlushInterval: BigInt(500),
    datasourceConfigurations: [],
    fieldConfigurations: [],
    graphqlSchema: '',
    stringStorage: {},
    typeConfigurations: [],
  });

  for (const subgraph of input.subgraphs) {
    let schema: GraphQLSchema = new GraphQLSchema({});
    const { errors, normalizationResult } = normalizeSubgraphFromString(subgraph.sdl);
    if (errors) {
      throw new Error('Normalization failed', { cause: errors[0] });
    }
    if (normalizationResult?.schema) {
      schema = normalizationResult.schema;
    }

    // IMPORTANT NOTE: printSchema and printSchemaWithDirectives promotes extension types to "full" types
    const upstreamSchema = internString(engineConfig, printSchemaWithDirectives(lexicographicSortSchema(schema)));
    const { childNodes, rootNodes, keys, provides, requires } = configurationDataMapToDataSourceConfiguration(
      normalizationResult!.configurationDataMap,
    );
    let subscriptionProtocol: GraphQLSubscriptionProtocol;
    switch (subgraph.subscriptions?.protocol ?? '') {
      case '':
      case 'ws': {
        subscriptionProtocol = GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_WS;
        break;
      }
      case 'sse': {
        subscriptionProtocol = GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE;
        break;
      }
      case 'sse-post': {
        subscriptionProtocol = GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST;
        break;
      }
      default: {
        throw new Error(
          `unknown subscription protocol ${subgraph.subscriptions?.protocol} in subgraph ${subgraph.name}`,
        );
      }
    }
    const datasourceConfig = new DataSourceConfiguration({
      // When changing this, please do it in the router subgraph override as well
      id: subgraph.url,
      childNodes,
      rootNodes,
      keys,
      provides,
      requires,
      kind: DataSourceKind.GRAPHQL,
      customGraphql: {
        customScalarTypeFields: [],
        federation: {
          enabled: true,
          serviceSdl: subgraph.sdl,
        },
        upstreamSchema,
        fetch: {
          url: new ConfigurationVariable({
            kind: ConfigurationVariableKind.STATIC_CONFIGURATION_VARIABLE,
            staticVariableContent: subgraph.url,
          }),
          method: HTTPMethod.POST,
          header: {},
          body: {},
          baseUrl: {},
          path: {},
        },
        subscription: {
          enabled: true,
          // When changing this, please do it in the router subgraph override as well
          url: new ConfigurationVariable({
            kind: ConfigurationVariableKind.STATIC_CONFIGURATION_VARIABLE,
            staticVariableContent: subgraph.url,
          }),
          protocol: subscriptionProtocol,
        },
      },
      directives: [],
      overrideFieldPathFromAlias: true,
      requestTimeoutSeconds: BigInt(10),
    });
    engineConfig.datasourceConfigurations.push(datasourceConfig);
  }
  engineConfig.fieldConfigurations = argumentConfigurationDatasToFieldConfigurations(input.argumentConfigurations);
  engineConfig.graphqlSchema = input.federatedSDL;
  return new RouterConfig({
    engineConfig,
    subgraphs: input.subgraphs.map((s) => ({
      id: s.id,
      name: s.name,
      routingUrl: s.url,
    })),
  });
};
