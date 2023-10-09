import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino, { LoggerOptions } from 'pino';
import * as schema from '../../db/schema.js';
import { FederatedGraphDTO, MigrationSubgraph } from '../../types/index.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { sanitizeMigratedGraphName } from '../util.js';

export default class ApolloMigrator {
  apiKey = '';
  organizationSlug = '';
  variantName = '';
  logger: pino.Logger<LoggerOptions>;
  userId = '';
  userEmail = '';

  constructor({
    apiKey,
    organizationSlug,
    variantName,
    logger,
    userId,
    userEmail,
  }: {
    apiKey: string;
    organizationSlug: string;
    variantName: string;
    logger: pino.Logger<LoggerOptions>;
    userId: string;
    userEmail: string;
  }) {
    this.apiKey = apiKey;
    this.organizationSlug = organizationSlug;
    this.variantName = variantName;
    this.logger = logger;
    this.userEmail = userEmail;
    this.userId = userId;
  }

  public async fetchGraphID(): Promise<{ success: boolean; id: string; name: string }> {
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
      this.logger.error(
        { response, user: { id: this.userId, email: this.userEmail } },
        'Could not fetch the graph from apollo, status code returned is non 200.',
      );
      return {
        success: false,
        id: '',
        name: '',
      };
    }
    const body = await response.json();
    const data = body.data;

    if (!data.me) {
      this.logger.error(
        { data, user: { id: this.userId, email: this.userEmail } },
        'Could not fetch the graph from apollo.',
      );
      return {
        success: false,
        id: '',
        name: '',
      };
    }

    return {
      success: true,
      id: data.me.id,
      name: data.me.name,
    };
  }

  // fetches the schemas of the subgraphs and the routing url of the federated graph
  public async fetchGraphDetails({ graphID }: { graphID: string }): Promise<{
    success: boolean;
    fedGraphRoutingURL: string;
    subgraphs: MigrationSubgraph[];
    errorMessage?: string;
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
      this.logger.error(
        { response, user: { id: this.userId, email: this.userEmail } },
        'Could not fetch the graph details from apollo, status code returned is non 200.',
      );
      return {
        success: false,
        fedGraphRoutingURL: '',
        subgraphs: [],
        errorMessage: 'Could not fetch the graph details from apollo.',
      };
    }
    const body = await response.json();
    const data = body.data;
    const variants: any[] = data.graph.variants;

    const variant = variants.find((v: { name: string }) => v.name === this.variantName);

    if (!variant) {
      this.logger.error(
        { data, user: { id: this.userId, email: this.userEmail } },
        'Could not find the requested variant of the graph.',
      );
      return {
        success: false,
        fedGraphRoutingURL: '',
        subgraphs: [],
        errorMessage: 'Could not find the requested variant of the graph.',
      };
    }
    const subgraphs: any[] = variant.subgraphs;

    if (!subgraphs || subgraphs.length === 0) {
      this.logger.error(
        { data, user: { id: this.userId, email: this.userEmail } },
        `Could not fetch the subgraphs of the ${this.variantName} variant.`,
      );
      return {
        success: false,
        fedGraphRoutingURL: '',
        subgraphs: [],
        errorMessage: `Could not fetch the subgraphs of the ${this.variantName} variant.`,
      };
    }

    return {
      success: true,
      fedGraphRoutingURL: variant.url,
      subgraphs:
        subgraphs.map((subgraph) => {
          return {
            name: subgraph.name,
            routingURL: subgraph.url,
            schema: subgraph.activePartialSchema.sdl,
          } as MigrationSubgraph;
        }) || [],
    };
  }

  public migrateGraphFromApollo({
    fedGraph,
    subgraphs,
    organizationID,
    db,
  }: {
    fedGraph: {
      name: string;
      routingURL: string;
    };
    subgraphs: MigrationSubgraph[];
    organizationID: string;
    db: PostgresJsDatabase<typeof schema>;
  }): Promise<FederatedGraphDTO> {
    return db.transaction<FederatedGraphDTO>(async (db) => {
      const fedGraphRepo = new FederatedGraphRepository(db, organizationID);
      const subgraphRepo = new SubgraphRepository(db, organizationID);
      const sanitizedGraphName = sanitizeMigratedGraphName(fedGraph.name);
      const federatedGraph = await fedGraphRepo.create({
        name: fedGraph.name,
        labelMatchers: ['env=main', `name=${sanitizedGraphName}`],
        routingUrl: fedGraph.routingURL,
      });

      for (const subgraph of subgraphs) {
        await subgraphRepo.create({
          name: subgraph.name,
          labels: [
            { key: 'env', value: 'main' },
            { key: 'name', value: sanitizedGraphName },
          ],
          routingUrl: subgraph.routingURL,
        });

        await subgraphRepo.updateSchema(subgraph.name, subgraph.schema);
      }

      return federatedGraph;
    });
  }
}
