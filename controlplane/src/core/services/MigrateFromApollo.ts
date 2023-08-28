interface Subgraph {
  name: string;
  routingURL: string;
  schema: string;
}

export default class MigrateFromApollo {
  apiKey = '';
  organizationSlug = '';
  constructor({ apiKey, organizationSlug }: { apiKey: string; organizationSlug: string }) {
    this.apiKey = apiKey;
    this.organizationSlug = organizationSlug;
  }

  public async fetchGraphID(): Promise<{ id: string; name: string }> {
    const headers = new Headers();
    headers.append('X-API-KEY', this.apiKey);
    headers.append('apollographql-client-name', this.organizationSlug);
    headers.append('apollographql-client-version', '1.0.0');
    headers.append('Content-Type', 'application/json');

    const graphql = JSON.stringify({
      operationName: 'ListVisibleGraphs',
      query: `
        query ListVisibleGraphs {
          me {
            id
            name
          }
        }
      `,
      variables: {},
    });

    const response = await fetch('https://graphql.api.apollographql.com/api/graphql', {
      method: 'POST',
      headers,
      body: graphql,
    });
    if (response.status !== 200) {
      throw new Error('Could not fetch the graph from apollo.');
    }
    const body = await response.json();
    const data = body.data;
    return {
      id: data.me.id,
      name: data.me.name,
    };
  }

  // fetches the schemas of the subgraphs and the routing url of the federated graph
  public async fetchGraphDetails({ graphID, variantName }: { graphID: string; variantName: string }): Promise<{
    fedGraphRoutingURL: string;
    subgraphs: Subgraph[];
  }> {
    const headers = new Headers();
    headers.append('X-API-KEY', this.apiKey);
    headers.append('apollographql-client-name', this.organizationSlug);
    headers.append('apollographql-client-version', '1.0.0');
    headers.append('Content-Type', 'application/json');

    const graphql = JSON.stringify({
      query: `
        query GetGraph($graphId: ID!) {
          graph(id: $graphId) {
            id
            title
            variants {
              id
              url
              name
              subgraphs {
                name
                url
                activePartialSchema {
                  sdl
                }
              }
            }
          }
        }
      `,
      variables: {
        graphId: graphID,
      },
    });

    const response = await fetch('https://graphql.api.apollographql.com/api/graphql', {
      method: 'POST',
      headers,
      body: graphql,
    });
    if (response.status !== 200) {
      throw new Error('Could not fetch the subgraphs from apollo.');
    }
    const body = await response.json();
    const data = body.data;
    const variants: any[] = data.graph.variants;

    const variant = variants.find((v: { name: string }) => v.name === variantName);

    if (!variant) {
      throw new Error('Could not find the requested variant of the graph.');
    }
    const subgraphs: any[] = variant.subgraphs;

    return {
      fedGraphRoutingURL: variant.url,
      subgraphs: subgraphs.map((subgraph) => {
        return {
          name: subgraph.name,
          routingURL: subgraph.url,
          schema: subgraph.activePartialSchema.sdl,
        } as Subgraph;
      }),
    };
  }
}
