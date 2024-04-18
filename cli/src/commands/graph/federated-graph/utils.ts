import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { program } from 'commander';
import { BREAK, parse, visit } from 'graphql';
import jwtDecode from 'jwt-decode';
import pc from 'picocolors';
import { Client } from '../../../core/client/client.js';
import { config, getBaseHeaders } from '../../../core/config.js';
import { GraphToken } from '../../auth/utils.js';

export const fetchRouterConfig = async ({
  client,
  name,
  namespace,
}: {
  client: Client;
  name: string;
  namespace: string;
}) => {
  const resp = await client.platform.generateRouterToken(
    {
      fedGraphName: name,
      namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code !== EnumStatusCode.OK) {
    console.log(`${pc.red(`Could not fetch the router config for the graph ${pc.bold(name)}`)}`);
    if (resp.response?.details) {
      console.log(pc.red(pc.bold(resp.response?.details)));
    }
    process.exit(1);
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

export const getSubgraphsOfFedGraph = async ({
  client,
  name,
  namespace,
}: {
  client: Client;
  name: string;
  namespace: string;
}) => {
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
    console.log(`${pc.red(`Could not fetch the federated graph ${pc.bold(name)}`)}`);
    if (resp.response?.details) {
      console.log(pc.red(pc.bold(resp.response?.details)));
    }
    process.exit(1);
  }

  const subgraphs = await resp.subgraphs;

  return subgraphs.map((s) => {
    return {
      name: s.name,
      routingURL: s.routingURL,
      subscriptionURL: s.subscriptionUrl,
      subscriptionProtocol: s.subscriptionProtocol,
      isV2Graph: s.isV2Graph,
    };
  });
};

export const getFederatedGraphSDL = async ({
  client,
  name,
  namespace,
}: {
  client: Client;
  name: string;
  namespace: string;
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
    console.log(`${pc.red(`Could not fetch the SDL of the federated graph ${pc.bold(name)}`)}`);
    if (resp.response?.details) {
      console.log(pc.red(pc.bold(resp.response?.details)));
    }
    process.exit(1);
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
}: {
  client: Client;
  fedGraphName: string;
  subgraphName: string;
  namespace: string;
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
    console.log(`${pc.red(`Could not fetch the SDL of the subgraph ${pc.bold(subgraphName)}`)}`);
    if (resp.response?.details) {
      console.log(pc.red(pc.bold(resp.response?.details)));
    }
    process.exit(1);
  }

  const sdl = await resp.sdl;

  return sdl;
};

export const injectRequiredDirectives = (schema: string, isV2Graph?: boolean) => {
  const linkDirective = `extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.5"
    import: [
      "@authenticated"
      "@composeDirective"
      "@extends"
      "@external"
      "@inaccessible"
      "@interfaceObject"
      "@override"
      "@provides"
      "@key"
      "@requires"
      "@requiresScopes"
      "@shareable"
      "@tag"
    ]
  )

`;
  let hasDefinedLink = false;
  if (!isV2Graph) {
    return schema;
  }
  visit(parse(schema), {
    SchemaDefinition: {
      enter(node) {
        if (!node.directives) {
          return false;
        }
        for (const directive of node.directives) {
          if (directive.name.value === 'link') {
            hasDefinedLink = true;
            return BREAK;
          }
        }
        return false;
      },
    },
    SchemaExtension: {
      enter(node) {
        if (!node.directives) {
          return false;
        }
        for (const directive of node.directives) {
          if (directive.name.value === 'link') {
            hasDefinedLink = true;
            return BREAK;
          }
        }
        return false;
      },
    },
  });

  if (!hasDefinedLink) {
    return linkDirective + schema;
  }
  return schema;
};
