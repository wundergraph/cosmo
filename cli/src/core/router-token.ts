import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getBaseHeaders } from './config.js';
import type { BaseCommandOptions } from './types/types.js';

export interface CreateRouterTokenParams {
  client: BaseCommandOptions['client'];
  tokenName: string;
  graphName: string;
  namespace?: string;
}

export interface CreateRouterTokenResult {
  error: Error | null;
  token?: string;
}

export interface DeleteRouterTokenParams {
  client: BaseCommandOptions['client'];
  tokenName: string;
  graphName: string;
  namespace?: string;
}

export interface DeleteRouterTokenResult {
  error: Error | null;
}

/**
 * Creates a router token for a federated graph.
 * Never calls program.error() — caller decides how to handle errors.
 */
export async function createRouterToken(params: CreateRouterTokenParams): Promise<CreateRouterTokenResult> {
  const { client, tokenName, graphName, namespace } = params;

  const resp = await client.platform.createFederatedGraphToken(
    {
      tokenName,
      graphName,
      namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code === EnumStatusCode.OK) {
    return { error: null, token: resp.token };
  }

  return { error: new Error(resp.response?.details ?? 'Could not create router token') };
}

/**
 * Deletes a router token. Idempotent — returns success if token doesn't exist.
 * Never calls program.error() — caller decides how to handle errors.
 */
export async function deleteRouterToken(params: DeleteRouterTokenParams): Promise<DeleteRouterTokenResult> {
  const { client, tokenName, graphName, namespace } = params;

  const resp = await client.platform.deleteRouterToken(
    {
      tokenName,
      fedGraphName: graphName,
      namespace,
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (resp.response?.code === EnumStatusCode.OK) {
    return { error: null };
  }

  // Treat "doesn't exist" as success (idempotent)
  if (resp.response?.details?.includes("doesn't exist")) {
    return { error: null };
  }

  return { error: new Error(resp.response?.details ?? 'Could not delete router token') };
}
