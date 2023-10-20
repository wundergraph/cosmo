import { parse, printSchema } from 'graphql';
import { JsonValue } from '@bufbuild/protobuf';
import { buildRouterConfig } from '@wundergraph/cosmo-shared';
import { CompositionError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
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
   * Composes a list of subgraphs based on the label selection into multiple federated schemas.
   * If it succeeds, it returns the composed schemas. Any errors are returned in the errors array.
   */
  async compose(subgraphLabels: Label[]): Promise<CompositionResult> {
    const composedGraphs: Promise<ComposedFederatedGraph>[] = [];

    const federatedGraphs = await this.federatedGraphRepo.bySubgraphLabels(subgraphLabels);
    for (const graph of federatedGraphs) {
      composedGraphs.push(this.composeFederatedGraph(graph.name, graph.targetId));
    }

    return {
      compositions: await Promise.all(composedGraphs),
    };
  }

  /**
   * Build and store the final router config and federated schema. If the composition is valid, it stores the
   * changes between the previous and the new schema in the changelog table. In all cases, it updates the
   * federated graph table with the new schema, but it might mark the graph as not composable if there are errors.
   * This has to be checked before we promote the new schema to the production router.
   */
  async updateComposedSchema(composedGraph: ComposedFederatedGraph) {
    const compositionErrors: CompositionError[] = [];

    const hasErrors = composedGraph.errors.length > 0;

    // Build router config when composed schema is valid
    let routerConfigJson: JsonValue = null;
    if (!hasErrors && composedGraph.composedSchema) {
      const routerConfig = buildRouterConfig({
        argumentConfigurations: composedGraph.argumentConfigurations,
        subgraphs: composedGraph.subgraphs,
        federatedSDL: composedGraph.composedSchema,
      });
      routerConfigJson = routerConfig.toJson();
    }

    const prevFederatedSDL = await this.federatedGraphRepo.getLatestSdlOfFederatedGraph(composedGraph.name);

    // We always create a new version in the database, but
    // we might mark versions with compositions errors as not composable
    // The routerConfig is stored along with the valid composed schema
    const updatedFederatedGraph = await this.federatedGraphRepo.updateSchema({
      graphName: composedGraph.name,
      composedSDL: composedGraph.composedSchema,
      compositionErrors: composedGraph.errors,
      routerConfig: routerConfigJson,
    });

    // If the composed schema is valid, we store the changes between the previous and the new schema
    if (!hasErrors && composedGraph.composedSchema && updatedFederatedGraph?.composedSchemaVersionId) {
      const schemaChanges = await getDiffBetweenGraphs(prevFederatedSDL || '', composedGraph.composedSchema);

      if (schemaChanges.kind !== 'failure' && schemaChanges.changes.length > 0) {
        await this.federatedGraphRepo.createFederatedGraphChangelog({
          schemaVersionID: updatedFederatedGraph.composedSchemaVersionId,
          changes: schemaChanges.changes,
        });
      }
    }

    for (const error of composedGraph.errors) {
      compositionErrors.push({
        message: error.message,
        federatedGraphName: composedGraph.name,
      } as CompositionError);
    }

    return compositionErrors;
  }

  /**
   * Composes all subgraphs of a federated graph into a single federated graph.
   */
  async composeFederatedGraph(name: string, targetID: string): Promise<ComposedFederatedGraph> {
    try {
      const subgraphs = await this.subgraphRepo.listByFederatedGraph(name, {
        published: true,
      });

      if (subgraphs.length === 0) {
        return {
          argumentConfigurations: [],
          name,
          targetID,
          errors: [new Error('No published subgraphs to compose.')],
          subgraphs: [],
        };
      }

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
