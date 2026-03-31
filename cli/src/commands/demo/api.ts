import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { FederatedGraph, Subgraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { BaseCommandOptions } from '../../core/types/types.js';
import { getBaseHeaders } from '../../core/config.js';

/**
 * Retrieve user information [email] and [organization name]
 */
export async function fetchUserInfo(client: BaseCommandOptions['client']) {
  const response = await client.platform.whoAmI(
    {},
    {
      headers: getBaseHeaders(),
    },
  );

  switch (response.response?.code) {
    case EnumStatusCode.OK: {
      return {
        userInfo: {
          userEmail: response.userEmail,
          organizationName: response.organizationName,
        },
        error: null,
      };
    }
    default: {
      return {
        userInfo: null,
        error: new Error(response.response?.details ?? 'An unknown error occured'),
      };
    }
  }
}

/**
 * Retrieve onboarding record. Provides information about allowed [status]:
 * [error] | [not-allowed] | [ok]
 * If record exists, returns [onboarding] metadata.
 */
export async function checkExistingOnboarding(client: BaseCommandOptions['client']) {
  const { response, finishedAt, enabled } = await client.platform.getOnboarding(
    {},
    {
      headers: getBaseHeaders(),
    },
  );

  if (response?.code !== EnumStatusCode.OK) {
    return {
      error: new Error(response?.details ?? 'Failed to fetch onboarding metadata.'),
      status: 'error',
    } as const;
  }

  if (!enabled) {
    return {
      status: 'not-allowed',
    } as const;
  }

  return {
    onboarding: {
      finishedAt,
    },
    status: 'ok',
  } as const;
}

/**
 * Retrieves federated graph by [name] *demo*. Missing federated graph
 * is a valid state.
 */
export async function fetchFederatedGraphByName(
  client: BaseCommandOptions['client'],
  { name, namespace }: { name: string; namespace: string },
) {
  const { response, graph, subgraphs } = await client.platform.getFederatedGraphByName(
    {
      name,
      namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  switch (response?.code) {
    case EnumStatusCode.OK: {
      return { data: { graph, subgraphs }, error: null };
    }
    case EnumStatusCode.ERR_NOT_FOUND: {
      return { data: null, error: null };
    }
    default: {
      return {
        data: null,
        error: new Error(response?.details ?? 'An unknown error occured'),
      };
    }
  }
}

/**
 * Cleans up the federated graph by [name] _demo_ and its related
 * subgraphs.
 */
export async function cleanUpFederatedGraph(
  client: BaseCommandOptions['client'],
  graphData: {
    graph: FederatedGraph;
    subgraphs: Subgraph[];
  },
) {
  const subgraphDeleteResponses = await Promise.all(
    graphData.subgraphs.map(({ name, namespace }) =>
      client.platform.deleteFederatedSubgraph(
        {
          namespace,
          subgraphName: name,
          disableResolvabilityValidation: false,
        },
        {
          headers: getBaseHeaders(),
        },
      ),
    ),
  );

  const failedSubgraphDeleteResponses = subgraphDeleteResponses.filter(
    ({ response }) => response?.code !== EnumStatusCode.OK,
  );

  if (failedSubgraphDeleteResponses.length > 0) {
    return {
      error: new Error(
        failedSubgraphDeleteResponses.map(({ response }) => response?.details ?? 'Unknown error occurred.').join('. '),
      ),
    };
  }

  const federatedGraphDeleteResponse = await client.platform.deleteFederatedGraph(
    {
      name: graphData.graph.name,
      namespace: graphData.graph.namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  switch (federatedGraphDeleteResponse.response?.code) {
    case EnumStatusCode.OK: {
      return {
        error: null,
      };
    }
    default: {
      return {
        error: new Error(federatedGraphDeleteResponse.response?.details ?? 'Unknown error occurred.'),
      };
    }
  }
}

/**
 * Creates federated graph using default [name] and [namespace], with pre-defined
 * [labelMatcher] which identify the graph as _demo_.
 */
export async function createFederatedGraph(
  client: BaseCommandOptions['client'],
  options: {
    name: string;
    namespace: string;
    labelMatcher: string;
    routingUrl: URL;
  },
) {
  const createFedGraphResponse = await client.platform.createFederatedGraph(
    {
      name: options.name,
      namespace: options.namespace,
      routingUrl: options.routingUrl.toString(),
      labelMatchers: [options.labelMatcher],
    },
    {
      headers: getBaseHeaders(),
    },
  );

  switch (createFedGraphResponse.response?.code) {
    case EnumStatusCode.OK: {
      return { error: null };
    }
    default: {
      return {
        error: new Error(createFedGraphResponse.response?.details ?? 'An unknown error occured'),
      };
    }
  }
}
