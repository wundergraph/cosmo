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
