import { GRPCMapping } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { SubgraphKind, type SubscriptionProtocol, type WebsocketSubprotocol } from '@wundergraph/cosmo-shared';

export type ConfigSubgraph = StandardSubgraphConfig | SubgraphPluginConfig | GRPCSubgraphConfig;

export type StandardSubgraphConfig = {
  name: string;
  routing_url: string;
  schema?: {
    file: string;
  };
  subscription?: {
    url?: string;
    protocol?: 'ws' | 'sse' | 'sse_post';
    websocketSubprotocol?: 'auto' | 'graphql-ws' | 'graphql-transport-ws';
  };
  introspection?: {
    url: string;
    headers?: {
      [key: string]: string;
    };
    raw?: boolean;
  };
};

export type SubgraphPluginConfig = {
  plugin: {
    version: string;
    path: string;
  };
};

export type GRPCSubgraphConfig = {
  name: string;
  routing_url: string;
  grpc: {
    schema_file: string;
    proto_file: string;
    mapping_file: string;
  };
};

export type SubgraphMetaData = StandardSubgraphMetaData | SubgraphPluginMetadata | GRPCSubgraphMetadata;

export type StandardSubgraphMetaData = {
  kind: SubgraphKind.Standard;
  name: string;
  sdl: string;
  routingUrl: string;
  subscriptionUrl: string;
  subscriptionProtocol: SubscriptionProtocol;
  websocketSubprotocol: WebsocketSubprotocol;
};

export type SubgraphPluginMetadata = {
  kind: SubgraphKind.Plugin;
  name: string;
  sdl: string;
  mapping: GRPCMapping;
  protoSchema: string;
  version: string;
};

export type GRPCSubgraphMetadata = {
  kind: SubgraphKind.GRPC;
  name: string;
  sdl: string;
  routingUrl: string;
  protoSchema: string;
  mapping: GRPCMapping;
};

export type Config = {
  version: number;
  subgraphs: ConfigSubgraph[];
  feature_flags?: {
    name: string;
    feature_graphs: (StandardSubgraphConfig & { subgraph_name: string })[];
  }[];
};
