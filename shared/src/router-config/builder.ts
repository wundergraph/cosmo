import crypto from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  COMPOSITION_VERSION,
  ConfigurationData,
  FieldConfiguration,
  ROOT_TYPE_NAMES,
  ROUTER_COMPATIBILITY_VERSIONS,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';
import { GraphQLSchema, lexicographicSortSchema } from 'graphql';
import {
  GraphQLSubscriptionProtocol,
  GraphQLWebsocketSubprotocol,
} from '@wundergraph/cosmo-connect/dist/common/common_pb';

import {
  ConfigurationVariable,
  ConfigurationVariableKind,
  DataSourceConfiguration,
  DataSourceCustom_GraphQL,
  DataSourceCustomEvents,
  DataSourceKind,
  EngineConfiguration,
  GraphQLSubscriptionConfiguration,
  GRPCConfiguration,
  GRPCMapping,
  HTTPMethod,
  InternedString,
  PluginConfiguration,
  RouterConfig,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { PartialMessage } from '@bufbuild/protobuf';
import { configurationDatasToDataSourceConfiguration, generateFieldConfigurations } from './graphql-configuration.js';
import { invalidRouterCompatibilityVersion, normalizationFailureError } from './errors.js';

export interface Input {
  federatedClientSDL: string;
  federatedSDL: string;
  fieldConfigurations: FieldConfiguration[];
  routerCompatibilityVersion: string;
  schemaVersionId: string;
  subgraphs: RouterSubgraph[];
}

/**
 * Protocol used when subscribing to a subgraph.
 *
 * ws: Negotiates an appropriate protocol over websockets. Both https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md and https://github.com/apollographql/subscriptions-transport-ws/blob/master/PROTOCOL.md are supported
 * sse: Uses the Server-Sent Events protocol with a GET request
 * sse_post: Uses the Server-Sent Events protocol with a POST request
 */
export type SubscriptionProtocol = 'ws' | 'sse' | 'sse_post';
export type WebsocketSubprotocol = 'auto' | 'graphql-ws' | 'graphql-transport-ws';

export enum SubgraphKind {
  Plugin,
  Standard,
  GRPC,
}

export type RouterSubgraph = ComposedSubgraph | ComposedSubgraphPlugin | ComposedSubgraphGRPC;

export interface ComposedSubgraph {
  kind: SubgraphKind.Standard;
  id: string;
  name: string;
  sdl: string;
  url: string;
  schemaVersionId?: string;
  subscriptionUrl: string;
  subscriptionProtocol?: SubscriptionProtocol | undefined;
  websocketSubprotocol?: WebsocketSubprotocol | undefined;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataByTypeName?: Map<string, ConfigurationData>;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
}

export interface ComposedSubgraphPlugin {
  kind: SubgraphKind.Plugin;
  id: string;
  version: string;
  name: string;
  sdl: string;
  url: string;
  protoSchema: string;
  mapping: GRPCMapping;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataByTypeName?: Map<string, ConfigurationData>;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
}

export interface ComposedSubgraphGRPC {
  kind: SubgraphKind.GRPC;
  id: string;
  name: string;
  sdl: string;
  url: string;
  protoSchema: string;
  mapping: GRPCMapping;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataByTypeName?: Map<string, ConfigurationData>;
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

export const parseGraphQLSubscriptionProtocol = (protocolName: SubscriptionProtocol): GraphQLSubscriptionProtocol => {
  switch (protocolName) {
    case 'ws': {
      return GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_WS;
    }
    case 'sse': {
      return GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE;
    }
    case 'sse_post': {
      return GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST;
    }
  }
};

export const parseGraphQLWebsocketSubprotocol = (protocolName: WebsocketSubprotocol): GraphQLWebsocketSubprotocol => {
  switch (protocolName) {
    case 'auto': {
      return GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO;
    }
    case 'graphql-ws': {
      return GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS;
    }
    case 'graphql-transport-ws': {
      return GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_TRANSPORT_WS;
    }
  }
};

export const buildRouterConfig = function (input: Input): RouterConfig {
  if (!ROUTER_COMPATIBILITY_VERSIONS.has(input.routerCompatibilityVersion as SupportedRouterCompatibilityVersion)) {
    throw invalidRouterCompatibilityVersion(input.routerCompatibilityVersion);
  }
  const engineConfig = new EngineConfiguration({
    defaultFlushInterval: BigInt(500),
    datasourceConfigurations: [],
    fieldConfigurations: [],
    graphqlSchema: '',
    stringStorage: {},
    typeConfigurations: [],
  });

  for (const subgraph of input.subgraphs) {
    if (!subgraph.configurationDataByTypeName) {
      throw normalizationFailureError('ConfigurationDataByTypeName');
    }
    if (!subgraph.schema) {
      throw normalizationFailureError('GraphQLSchema');
    }

    const subscriptionConfig: PartialMessage<GraphQLSubscriptionConfiguration> = {
      enabled: true,
    };

    // IMPORTANT NOTE: printSchema and printSchemaWithDirectives promotes extension types to "full" types
    const upstreamSchema = internString(
      engineConfig,
      printSchemaWithDirectives(lexicographicSortSchema(subgraph.schema)),
    );
    const { childNodes, entityInterfaces, events, interfaceObjects, keys, provides, requires, rootNodes } =
      configurationDatasToDataSourceConfiguration(subgraph.configurationDataByTypeName);

    let grcpConfig: GRPCConfiguration | undefined;

    switch (subgraph.kind) {
      case SubgraphKind.Standard: {
        subscriptionConfig.enabled = true;
        subscriptionConfig.protocol = parseGraphQLSubscriptionProtocol(subgraph.subscriptionProtocol || 'ws');
        subscriptionConfig.websocketSubprotocol = parseGraphQLWebsocketSubprotocol(
          subgraph.websocketSubprotocol || 'auto',
        );
        // When changing this, please do it in the router subgraph override as well
        subscriptionConfig.url = new ConfigurationVariable({
          kind: ConfigurationVariableKind.STATIC_CONFIGURATION_VARIABLE,
          staticVariableContent: subgraph.subscriptionUrl || subgraph.url,
        });

        break;
      }
      case SubgraphKind.Plugin: {
        grcpConfig = new GRPCConfiguration({
          mapping: subgraph.mapping,
          protoSchema: subgraph.protoSchema,
          plugin: new PluginConfiguration({
            name: subgraph.name,
            version: subgraph.version,
          }),
        });

        break;
      }
      case SubgraphKind.GRPC: {
        grcpConfig = new GRPCConfiguration({
          mapping: subgraph.mapping,
          protoSchema: subgraph.protoSchema,
        });

        break;
      }
      // No default
    }

    let kind: DataSourceKind;
    let customGraphql: DataSourceCustom_GraphQL | undefined;
    let customEvents: DataSourceCustomEvents | undefined;
    if (events.kafka.length > 0 || events.nats.length > 0 || events.redis.length > 0) {
      kind = DataSourceKind.PUBSUB;
      customEvents = new DataSourceCustomEvents({
        kafka: events.kafka,
        nats: events.nats,
        redis: events.redis,
      });
      // PUBSUB data sources cannot have root nodes other than
      // Query/Mutation/Subscription. Filter rootNodes in place
      // while moving items that do not pass the filter to childNodes.
      const isRootTypeNode = (node: TypeField) => {
        return ROOT_TYPE_NAMES.has(node.typeName);
      };
      let ii = 0;
      let filtered = 0;
      while (ii < rootNodes.length) {
        const node = rootNodes[ii];
        if (isRootTypeNode(node)) {
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
        grpc: grcpConfig,
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
        subscription: subscriptionConfig,
      });
    }

    const datasourceConfig = new DataSourceConfiguration({
      // When changing the id, make sure to change it in the router subgraph override also
      // https://github.com/wundergraph/cosmo/blob/main/router/core/router.go#L342
      id: subgraph.id,
      childNodes,
      customEvents,
      customGraphql,
      directives: [],
      entityInterfaces,
      interfaceObjects,
      keys,
      kind,
      overrideFieldPathFromAlias: true,
      provides,
      requestTimeoutSeconds: BigInt(10),
      requires,
      rootNodes,
    });
    engineConfig.datasourceConfigurations.push(datasourceConfig);
  }
  engineConfig.fieldConfigurations = generateFieldConfigurations(input.fieldConfigurations);
  engineConfig.graphqlSchema = input.federatedSDL;
  if (input.federatedClientSDL !== '') {
    engineConfig.graphqlClientSchema = input.federatedClientSDL;
  }
  return new RouterConfig({
    engineConfig,
    version: input.schemaVersionId,
    subgraphs: input.subgraphs.map((s) => ({
      id: s.id,
      name: s.name,
      routingUrl: s.url,
    })),
    compatibilityVersion: `${input.routerCompatibilityVersion}:${COMPOSITION_VERSION}`,
  });
};
