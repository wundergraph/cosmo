import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { Subgraph as ProtoSubgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import pc from 'picocolors';
import { Client } from '../../../core/client/client.js';
import { getBaseHeaders } from '../../../core/config.js';

export interface Subgraph {
  name: string;
  routingURL: string;
  subscriptionURL: string;
  subscriptionProtocol: string;
  isEventDrivenGraph?: boolean;
  isV2Graph?: boolean;
}

export const getSubgraphsOfFedGraph = async ({
  client,
  name,
  namespace,
}: {
  client: Client;
  name: string;
  namespace?: string;
}): Promise<Subgraph[]> => {
  const resp = await client.platform.getFederatedGraphByName(
    {
      name,
      namespace,
      includeMetrics: false,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    throw new Error(
      `${pc.red(`Could not fetch the federated graph ${pc.bold(name)}`)} \n${pc.red(
        pc.bold(resp.response?.details || ''),
      )}`,
    );
  }

  const subgraphs = await resp.subgraphs;

  return subgraphs.map((s: ProtoSubgraph) => {
    return {
      name: s.name,
      routingURL: s.routingURL,
      subscriptionURL: s.subscriptionUrl,
      subscriptionProtocol: s.subscriptionProtocol,
      isEventDrivenGraph: s.isEventDrivenGraph,
      isV2Graph: s.isV2Graph,
    };
  });
};

export const getFederatedGraphSchemas = async ({
  client,
  name,
  namespace,
}: {
  client: Client;
  name: string;
  namespace?: string;
}) => {
  const resp = await client.platform.getFederatedGraphSDLByName(
    {
      name,
      namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK || !resp?.sdl) {
    throw new Error(
      `${pc.red(`Could not fetch the SDL of the federated graph ${pc.bold(name)}`)} \n${pc.red(
        pc.bold(resp.response?.details || ''),
      )}`,
    );
  }

  return {
    sdl: resp.sdl,
    clientSchema: resp.clientSchema,
  };
};

// Returns the latest valid schema version of a subgraph that was composed to form the provided federated graph.
export const getSubgraphSDL = async ({
  client,
  fedGraphName,
  subgraphName,
  namespace,
}: {
  client: Client;
  fedGraphName: string;
  subgraphName: string;
  namespace?: string;
}) => {
  const resp = await client.platform.getSubgraphSDLFromLatestComposition(
    {
      name: subgraphName,
      namespace,
      fedGraphName,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    return undefined;
  }

  const sdl = await resp.sdl;

  return sdl;
};
