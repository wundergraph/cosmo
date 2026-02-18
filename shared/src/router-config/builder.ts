import crypto from 'node:crypto';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  COMPOSITION_VERSION,
  ConfigurationData,
  Costs,
  FieldConfiguration,
  ROOT_TYPE_NAMES,
  ROUTER_COMPATIBILITY_VERSIONS,
  SupportedRouterCompatibilityVersion,
  TypeName,
} from '@wundergraph/composition';
import {
  GraphQLSubscriptionProtocol,
  GraphQLWebsocketSubprotocol,
} from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GraphQLSchema, lexicographicSortSchema } from 'graphql';
import { PartialMessage } from '@bufbuild/protobuf';
import {
  ConfigurationVariable,
  ConfigurationVariableKind,
  CostConfiguration,
  DataSourceConfiguration,
  DataSourceCustom_GraphQL,
  DataSourceCustomEvents,
  DataSourceKind,
  EngineConfiguration,
  FieldListSizeConfiguration,
  FieldWeightConfiguration,
  GraphQLSubscriptionConfiguration,
  GRPCConfiguration,
  GRPCMapping,
  HTTPMethod,
  ImageReference,
  InternedString,
  PluginConfiguration,
  RouterConfig,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { invalidRouterCompatibilityVersion, normalizationFailureError } from './errors.js';
import { configurationDatasToDataSourceConfiguration, generateFieldConfigurations } from './graphql-configuration.js';

function costsToCostConfiguration(costs: Costs): CostConfiguration | undefined {
  const hasDirectiveArgWeights = costs.directiveArgumentWeights && costs.directiveArgumentWeights.size > 0;
  if (costs.fieldWeights.size === 0 && costs.listSizes.size === 0 && costs.typeWeights.size === 0 && !hasDirectiveArgWeights) {
    return undefined;
  }
  const fieldWeights: FieldWeightConfiguration[] = [];
  for (const [coord, fw] of costs.fieldWeights) {
    const dotIndex = coord.indexOf('.');
    const typeName = dotIndex >= 0 ? coord.substring(0, dotIndex) : coord;
    const fieldName = dotIndex >= 0 ? coord.substring(dotIndex + 1) : '';
    const argumentWeights: { [key: string]: number } = {};
    if (fw.argumentWeights) {
      for (const [argName, argWeight] of fw.argumentWeights) {
        argumentWeights[argName] = argWeight;
      }
    }
    fieldWeights.push(
      new FieldWeightConfiguration({
        typeName,
        fieldName,
        weight: fw.weight,
        argumentWeights,
      }),
    );
  }
  const listSizes: FieldListSizeConfiguration[] = [];
  for (const [coord, ls] of costs.listSizes) {
    const dotIndex = coord.indexOf('.');
    const typeName = dotIndex >= 0 ? coord.substring(0, dotIndex) : coord;
    const fieldName = dotIndex >= 0 ? coord.substring(dotIndex + 1) : '';
    listSizes.push(
      new FieldListSizeConfiguration({
        typeName,
        fieldName,
        assumedSize: ls.assumedSize,
        slicingArguments: ls.slicingArguments ?? [],
        sizedFields: ls.sizedFields ?? [],
        requireOneSlicingArgument: ls.requireOneSlicingArgument,
      }),
    );
  }
  const typeWeights: { [key: string]: number } = {};
  for (const [typeName, weight] of costs.typeWeights) {
    typeWeights[typeName] = weight;
  }
  const directiveArgumentWeights: { [key: string]: number } = {};
  if (costs.directiveArgumentWeights) {
    for (const [coord, weight] of costs.directiveArgumentWeights) {
      directiveArgumentWeights[coord] = weight;
    }
  }
  return new CostConfiguration({ fieldWeights, listSizes, typeWeights, directiveArgumentWeights });
}

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
  readonly kind: SubgraphKind.Standard;
  id: string;
  name: string;
  sdl: string;
  url: string;
  subscriptionUrl: string;
  subscriptionProtocol?: SubscriptionProtocol | undefined;
  websocketSubprotocol?: WebsocketSubprotocol | undefined;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataByTypeName?: Map<TypeName, ConfigurationData>;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
  costs?: Costs;
}

export interface ComposedSubgraphPlugin {
  readonly kind: SubgraphKind.Plugin;
  id: string;
  version: string;
  name: string;
  sdl: string;
  url: string;
  protoSchema: string;
  mapping: GRPCMapping;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataByTypeName?: Map<TypeName, ConfigurationData>;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
  imageReference?: ImageReference;
  costs?: Costs;
}

export interface ComposedSubgraphGRPC {
  readonly kind: SubgraphKind.GRPC;
  id: string;
  name: string;
  sdl: string;
  url: string;
  protoSchema: string;
  mapping: GRPCMapping;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataByTypeName?: Map<TypeName, ConfigurationData>;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
  costs?: Costs;
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
            imageReference: subgraph.imageReference,
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
      costConfiguration: subgraph.costs ? costsToCostConfiguration(subgraph.costs) : undefined,
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
