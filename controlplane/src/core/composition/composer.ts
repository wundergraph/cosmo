import { GraphQLSchema, parse, printSchema } from 'graphql';
import { JsonValue } from '@bufbuild/protobuf';
import { buildRouterConfig } from '@wundergraph/cosmo-shared';
import { ArgumentConfigurationData, ConfigurationDataMap, FederationResult } from '@wundergraph/composition';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { FederatedGraphDTO, Label, SubgraphDTO } from '../../types/index.js';
import { composeSubgraphs } from './composition.js';
import { getDiffBetweenGraphs } from './schemaCheck.js';

export type CompositionResult = {
  compositions: ComposedFederatedGraph[];
};

/**
 * Protocol used when subscribing to a subgraph.
 *
 * ws: Negotiates an appropriate protocol over websockets. Both https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md and https://github.com/apollographql/subscriptions-transport-ws/blob/master/PROTOCOL.md are supported
 * sse: Uses the Server-Sent Events protocol with a GET request
 * sse-post: Uses the Server-Sent Events protocol with a POST request
 */
type SubscriptionProtocol = 'ws' | 'sse' | 'sse_post';

interface ComposedSubgraph {
  id: string;
  name: string;
  sdl: string;
  url: string;
  subscriptionUrl: string;
  subscriptionProtocol: SubscriptionProtocol;
  // The intermediate representation of the engine configuration for the subgraph
  configurationDataMap?: ConfigurationDataMap;
  // The normalized GraphQL schema for the subgraph
  schema?: GraphQLSchema;
}

export function subgraphDTOsToComposedSubgraphs(
  subgraphs: SubgraphDTO[],
  result?: FederationResult,
): ComposedSubgraph[] {
  return subgraphs.map((subgraph) => {
    /* batchNormalize returns an intermediate representation of the engine configuration
     *  and a normalized schema per subgraph.
     *  Batch normalization is necessary because validation of certain things such as the @override directive requires
     *  knowledge of the other subgraphs.
     *  Each normalized schema and engine configuration is mapped by subgraph name to a SubgraphConfig object wrapper.
     *  This is passed to the FederationFactory and is returned by federateSubgraphs if federation is successful.
     *  The normalized schema and engine configuration is used by buildRouterConfig.
     * */
    const subgraphConfig = result?.subgraphConfigBySubgraphName.get(subgraph.name);
    const schema = subgraphConfig?.schema;
    const configurationDataMap = subgraphConfig?.configurationDataMap;
    return {
      id: subgraph.id,
      name: subgraph.name,
      url: subgraph.routingUrl,
      sdl: subgraph.schemaSDL,
      subscriptionUrl: subgraph.subscriptionUrl,
      subscriptionProtocol: subgraph.subscriptionProtocol,
      configurationDataMap,
      schema,
    };
  });
}

export interface ComposedFederatedGraph {
  id: string;
  targetID: string;
  name: string;
  composedSchema?: string;
  errors: Error[];
  subgraphs: ComposedSubgraph[];
  argumentConfigurations: ArgumentConfigurationData[];
}

export class Composer {
  constructor(
    private federatedGraphRepo: FederatedGraphRepository,
    private subgraphRepo: SubgraphRepository,
  ) {}

  /**
   * Build and store the final router config and federated schema to the database. A diff between the
   * previous and current schema is stored as changelog.
   */
  async deployComposition(composedGraph: ComposedFederatedGraph) {
    const hasCompositionErrors = composedGraph.errors.length > 0;

    let routerConfigJson: JsonValue = null;

    // Build router config when composed schema is valid
    if (!hasCompositionErrors && composedGraph.composedSchema) {
      const routerConfig = buildRouterConfig({
        argumentConfigurations: composedGraph.argumentConfigurations,
        subgraphs: composedGraph.subgraphs,
        federatedSDL: composedGraph.composedSchema,
      });
      routerConfigJson = routerConfig.toJson();
    }

    const prevValidFederatedSDL = await this.federatedGraphRepo.getLatestValidSdlOfFederatedGraph(composedGraph.name);

    const updatedFederatedGraph = await this.federatedGraphRepo.addSchemaVersion({
      graphName: composedGraph.name,
      composedSDL: composedGraph.composedSchema,
      compositionErrors: composedGraph.errors,
      routerConfig: routerConfigJson,
    });

    // Only create changelog when the composed schema is valid
    if (!hasCompositionErrors && composedGraph.composedSchema && updatedFederatedGraph?.composedSchemaVersionId) {
      const schemaChanges = await getDiffBetweenGraphs(prevValidFederatedSDL || '', composedGraph.composedSchema);

      if (schemaChanges.kind !== 'failure' && schemaChanges.changes.length > 0) {
        await this.federatedGraphRepo.createFederatedGraphChangelog({
          schemaVersionID: updatedFederatedGraph.composedSchemaVersionId,
          changes: schemaChanges.changes,
        });
      }
    }
  }

  /**
   * Composes all subgraphs of a federated graph into a single federated graph.
   * Optionally, you can pass extra subgraphs to include them in the composition.
   */
  async composeFederatedGraph(federatedGraph: FederatedGraphDTO): Promise<ComposedFederatedGraph> {
    try {
      const subgraphs = await this.subgraphRepo.listByFederatedGraph(federatedGraph.name, {
        published: true,
      });

      // A federated graph must have at least one subgraph. Let the composition fail if there are none.

      const { errors, federationResult: result } = composeSubgraphs(
        subgraphs.map((s) => ({
          name: s.name,
          url: s.routingUrl,
          definitions: parse(s.schemaSDL),
        })),
      );

      return {
        id: federatedGraph.id,
        name: federatedGraph.name,
        targetID: federatedGraph.targetId,
        composedSchema: result?.federatedGraphSchema ? printSchema(result.federatedGraphSchema) : undefined,
        errors: errors || [],
        argumentConfigurations: result?.argumentConfigurations || [],
        subgraphs: subgraphDTOsToComposedSubgraphs(subgraphs, result),
      };
    } catch (e: any) {
      return {
        id: federatedGraph.id,
        name: federatedGraph.name,
        targetID: federatedGraph.targetId,
        argumentConfigurations: [],
        errors: [e],
        subgraphs: [],
      };
    }
  }

  /**
   * Same as compose, but the proposed schemaSDL of the subgraph is not updated to the table, so it is passed to the function
   */
  async composeWithProposedSDL(
    subgraphLabels: Label[],
    subgraphName: string,
    subgraphSchemaSDL: string,
  ): Promise<CompositionResult> {
    const composedGraphs: ComposedFederatedGraph[] = [];

    for await (const graph of await this.federatedGraphRepo.bySubgraphLabels(subgraphLabels)) {
      try {
        const subgraphs = await this.subgraphRepo.listByFederatedGraph(graph.name);
        const subgraphsToBeComposed = [];

        for (const subgraph of subgraphs) {
          if (subgraph.name === subgraphName) {
            subgraphsToBeComposed.push({
              name: subgraph.name,
              url: subgraph.routingUrl,
              definitions: parse(subgraphSchemaSDL),
            });
          } else if (subgraph.schemaSDL !== '') {
            subgraphsToBeComposed.push({
              name: subgraph.name,
              url: subgraph.routingUrl,
              definitions: parse(subgraph.schemaSDL),
            });
          }
        }

        const { errors, federationResult: result } = composeSubgraphs(subgraphsToBeComposed);
        composedGraphs.push({
          id: graph.id,
          name: graph.name,
          targetID: graph.targetId,
          argumentConfigurations: result?.argumentConfigurations || [],
          composedSchema: result?.federatedGraphSchema ? printSchema(result.federatedGraphSchema) : undefined,
          errors: errors || [],
          subgraphs: subgraphDTOsToComposedSubgraphs(subgraphs, result),
        });
      } catch (e: any) {
        composedGraphs.push({
          id: graph.id,
          name: graph.name,
          targetID: graph.targetId,
          argumentConfigurations: [],
          errors: [e],
          subgraphs: [],
        });
      }
    }
    return {
      compositions: composedGraphs,
    };
  }
}
