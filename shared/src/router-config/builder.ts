import crypto from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { ArgumentConfigurationData, ConfigurationDataMap } from '@wundergraph/composition';
import { GraphQLSchema, lexicographicSortSchema } from 'graphql';
import { GraphQLSubscriptionProtocol } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ConfigurationVariable,
  ConfigurationVariableKind,
  DataSourceConfiguration,
  // eslint-disable-next-line camelcase
  DataSourceCustom_Events,
  // eslint-disable-next-line camelcase
  DataSourceCustom_GraphQL,
  DataSourceKind,
  EngineConfiguration,
  HTTPMethod,
  InternedString,
  RouterConfig,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  argumentConfigurationDatasToFieldConfigurations,
  configurationDataMapToDataSourceConfiguration,
} from './graphql-configuration.js';
import { normalizationFailureError } from './errors.js';

export interface Input {
  argumentConfigurations: ArgumentConfigurationData[];
  federatedSDL: string;
  subgraphs: ComposedSubgraph[];
}

/**
 * Protocol used when subscribing to a subgraph.
 *
 * ws: Negotiates an appropriate protocol over websockets. Both https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md and https://github.com/apollographql/subscriptions-transport-ws/blob/master/PROTOCOL.md are supported
 * sse: Uses the Server-Sent Events protocol with a GET request
 * sse-post: Uses the Server-Sent Events protocol with a POST request
 */
export type SubscriptionProtocol = 'ws' | 'sse' | 'sse_post';

export interface ComposedSubgraph {
  id: string;
  name: string;
  sdl: string;
  schemaVersionId?: string;
  url: string;
  subscriptionUrl: string;
  subscriptionProtocol: SubscriptionProtocol;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataMap?: ConfigurationDataMap;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
}

export const internString = (config: EngineConfiguration, str: string): InternedString => {
  const key = crypto.createHash('sha1').update(str).digest('hex');
  config.stringStorage[key] = str;
  return new InternedString({
    key,
  });
};

export const parseGraphQLSubscriptionProtocol = (protocolName: string): GraphQLSubscriptionProtocol => {
  switch (protocolName) {
    case 'ws': {
      return GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_WS;
    }
    case 'sse': {
      return GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE;
    }
    case 'sse-post': {
      return GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST;
    }
  }
  throw new Error(`Unsupported subscription protocol '${protocolName}'`);
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
    if (!subgraph.configurationDataMap) {
      throw normalizationFailureError('ConfigurationDataMap');
    }
    if (!subgraph.schema) {
      throw normalizationFailureError('GraphQLSchema');
    }

    // IMPORTANT NOTE: printSchema and printSchemaWithDirectives promotes extension types to "full" types
    const upstreamSchema = internString(
      engineConfig,
      printSchemaWithDirectives(lexicographicSortSchema(subgraph.schema)),
    );
    const { childNodes, rootNodes, keys, provides, events, requires } = configurationDataMapToDataSourceConfiguration(
      subgraph.configurationDataMap,
    );
    const subscriptionProtocol = parseGraphQLSubscriptionProtocol(subgraph.subscriptionProtocol);
    let kind: DataSourceKind;
    // eslint-disable-next-line camelcase
    let customGraphql: DataSourceCustom_GraphQL | undefined;
    // eslint-disable-next-line camelcase
    let customEvents: DataSourceCustom_Events | undefined;
    if (events.length > 0) {
      kind = DataSourceKind.PUBSUB;
      customEvents = new DataSourceCustom_Events({
        events,
      });
      // PUBSUB data sources cannot have root nodes other than
      // Query/Mutation/Subscription. Filter rootNodes in place
      // while moving items that do not pass the filter to childNodes.
      const isWellKnownRootNode = (node: TypeField) => {
        return ['Query', 'Mutation', 'Subscription'].includes(node.typeName);
      };
      let ii = 0;
      let filtered = 0;
      while (ii < rootNodes.length) {
        const node = rootNodes[ii];
        if (isWellKnownRootNode(node)) {
          rootNodes[filtered++] = node;
        } else {
          childNodes.push(node);
        }
        ii++;
      }
      rootNodes.length = filtered;
    } else {
      kind = DataSourceKind.GRAPHQL;
      customGraphql = new DataSourceCustom_GraphQL({
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
            staticVariableContent: subgraph.subscriptionUrl ?? subgraph.url,
          }),
          protocol: subscriptionProtocol,
        },
      });
    }
    const datasourceConfig = new DataSourceConfiguration({
      // When changing this, please do it in the router subgraph override as well
      id: subgraph.id,
      childNodes,
      rootNodes,
      keys,
      provides,
      requires,
      kind,
      customGraphql,
      customEvents,
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
