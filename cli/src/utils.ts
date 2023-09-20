import { federateSubgraphs, FederationResultContainer, Subgraph } from '@wundergraph/composition';
import pc from 'picocolors';
import { config } from './core/config.js';

export interface Header {
  key: string;
  value: string;
}

export const introspectSubgraph = async ({
  subgraphURL,
  additionalHeaders,
}: {
  subgraphURL: string;
  additionalHeaders: Header[];
}): Promise<{ sdl: string; errorMessage?: string; success: boolean }> => {
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  for (const header of additionalHeaders) {
    headers.append(header.key, header.value);
  }

  const graphql = JSON.stringify({
    query: `
        {
          _service{
            sdl
          }
        }
      `,
    variables: {},
  });

  const response = await fetch(subgraphURL, {
    method: 'POST',
    headers,
    body: graphql,
  });
  if (response.status !== 200) {
    return {
      success: false,
      errorMessage: 'Could not introspect the subgraph.',
      sdl: '',
    };
  }
  const body = await response.json();
  const data = body.data;
  return {
    success: true,
    sdl: data._service.sdl,
  };
};

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[]): FederationResultContainer {
  return federateSubgraphs(subgraphs);
}

// checks if either of access token or api key are present
export function checkAPIKey() {
  if (!config.apiKey) {
    console.log(
      pc.yellow(
        `No AccessToken/API key found. Please run ${pc.bold(
          'wgc auth login',
        )} or create an API key and set as environment variable ${pc.bold('COSMO_API_KEY')}.` +
          '\n' +
          'Without an AccessToken/API key, you will not be able to interact with the control plane.',
      ) + '\n',
    );
  }
}
