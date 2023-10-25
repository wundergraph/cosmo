import { parse, printSchema } from 'graphql';
import { JsonValue } from '@bufbuild/protobuf';
import { buildRouterConfig } from '@wundergraph/cosmo-shared';
import { ArgumentConfigurationData } from '@wundergraph/composition';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { Label } from '../../types/index.js';
import { composeSubgraphs } from './composition.js';
import { getDiffBetweenGraphs } from './schemaCheck.js';

export type CompositionResult = {
  compositions: ComposedFederatedGraph[];
};

interface ComposedSubgraph {
  id: string;
  name: string;
  sdl: string;
  url: string;
  subscriptionUrl: string;
  subscriptionProtocol: 'ws' | 'sse' | 'sse_post';
}
export interface ComposedFederatedGraph {
  argumentConfigurations: ArgumentConfigurationData[];
  name: string;
  targetID: string;
  composedSchema?: string;
  errors: Error[];
  subgraphs: ComposedSubgraph[];
}

export class Composer {
  constructor(private federatedGraphRepo: FederatedGraphRepository, private subgraphRepo: SubgraphRepository) {}

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
  async composeFederatedGraph(name: string, targetID: string): Promise<ComposedFederatedGraph> {
    try {
      const subgraphs = await this.subgraphRepo.listByFederatedGraph(name, {
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
        argumentConfigurations: result?.argumentConfigurations || [],
        name,
        targetID,
        composedSchema: result?.federatedGraphSchema ? printSchema(result.federatedGraphSchema) : undefined,
        errors: errors || [],
        subgraphs: subgraphs.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.routingUrl,
          sdl: s.schemaSDL,
          subscriptionUrl: s.subscriptionUrl,
          subscriptionProtocol: s.subscriptionProtocol,
        })),
      };
    } catch (e: any) {
      return {
        argumentConfigurations: [],
        name,
        targetID,
        errors: [e],
        subgraphs: [],
      };
    }
  }

  /**
   * Same as compose, but the proposed schemaSDL of the subgraph is not updated to the table so it is passed to the function
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
          argumentConfigurations: result?.argumentConfigurations || [],
          name: graph.name,
          targetID: graph.targetId,
          composedSchema: result?.federatedGraphSchema ? printSchema(result.federatedGraphSchema) : undefined,
          errors: errors || [],
          subgraphs: subgraphs.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.routingUrl,
            subscriptionUrl: s.subscriptionUrl,
            subscriptionProtocol: s.subscriptionProtocol,
            sdl: s.schemaSDL,
          })),
        });
      } catch (e: any) {
        composedGraphs.push({
          argumentConfigurations: [],
          name: graph.name,
          targetID: graph.targetId,
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
