import type { GRPCMapping } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { SubgraphKind, type SubscriptionProtocol, type WebsocketSubprotocol } from '@wundergraph/cosmo-shared';

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
