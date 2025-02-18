import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Subgraph as ProtoSubgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { program } from 'commander';
import jwtDecode from 'jwt-decode';
import pc from 'picocolors';
import { Client } from '../../../core/client/client.js';
import { config, getBaseHeaders } from '../../../core/config.js';
import { GraphToken } from '../../auth/utils.js';

export const fetchRouterConfig = async ({
  client,
  name,
  namespace,
  customHeaderParams,
}: {
  client: Client;
  name: string;
  namespace?: string;
  customHeaderParams?: string[];
}) => {
  const resp = await client.platform.generateRouterToken(
    {
      fedGraphName: name,
      namespace,
    },
    {
      headers: getBaseHeaders(customHeaderParams),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    throw new Error(
      `${pc.red(`Could not fetch the router config for the graph ${pc.bold(name)}`)} \n${pc.red(
        pc.bold(resp.response?.details || ''),
      )}`,
    );
  }

  let decoded: GraphToken;

  try {
    decoded = jwtDecode<GraphToken>(resp.token);
  } catch {
    program.error('Could not fetch the router config. Please try again');
  }

  const requestBody = JSON.stringify({
    Version: '',
  });

  const headers = new Headers();
  headers.append('Content-Type', 'application/json; charset=UTF-8');
  headers.append('Authorization', 'Bearer ' + resp.token);
  headers.append('Accept-Encoding', 'gzip');

  const url = new URL(
    `/${decoded.organization_id}/${decoded.federated_graph_id}/routerconfigs/latest.json`,
    config.cdnURL,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: requestBody,
  });

  const routerConfig = await response.text();

  return routerConfig;
};

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
  customHeaderParams,
}: {
  client: Client;
  name: string;
  namespace?: string;
  customHeaderParams?: string[];
}): Promise<Subgraph[]> => {
  const resp = await client.platform.getFederatedGraphByName(
    {
      name,
      namespace,
      includeMetrics: false,
    },
    {
      headers: getBaseHeaders(customHeaderParams),
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

export const getFederatedGraphSDL = async ({
  client,
  name,
  namespace,
  customHeaderParams,
}: {
  client: Client;
  name: string;
  namespace?: string;
  customHeaderParams?: string[];
}) => {
  const resp = await client.platform.getFederatedGraphSDLByName(
    {
      name,
      namespace,
    },
    {
      headers: getBaseHeaders(customHeaderParams),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK || !resp?.sdl) {
    throw new Error(
      `${pc.red(`Could not fetch the SDL of the federated graph ${pc.bold(name)}`)} \n${pc.red(
        pc.bold(resp.response?.details || ''),
      )}`,
    );
  }

  const sdl = await resp.sdl;

  return sdl;
};

// Returns the latest valid schema version of a subgraph that was composed to form the provided federated graph.
export const getSubgraphSDL = async ({
  client,
  fedGraphName,
  subgraphName,
  namespace,
  customHeaderParams,
}: {
  client: Client;
  fedGraphName: string;
  subgraphName: string;
  namespace?: string;
  customHeaderParams?: string[];
}) => {
  const resp = await client.platform.getSubgraphSDLFromLatestComposition(
    {
      name: subgraphName,
      namespace,
      fedGraphName,
    },
    {
      headers: getBaseHeaders(customHeaderParams),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    return undefined;
  }

  const sdl = await resp.sdl;

  return sdl;
};
