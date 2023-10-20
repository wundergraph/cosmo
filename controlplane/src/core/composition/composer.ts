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

export interface ComposedFederatedGraph {
  argumentConfigurations: ArgumentConfigurationData[];
  name: string;
  targetID: string;
  composedSchema?: string;
  errors: Error[];
  subgraphs: {
    id: string;
    name: string;
    sdl: string;
    url: string;
  }[];
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
   * Composes all subgraphs of a federated graph into a single federated graph.
   */
  async composeFederatedGraph(name: string, targetID: string): Promise<ComposedFederatedGraph> {
    try {
      const subgraphs = await this.subgraphRepo.listByFederatedGraph(name, {
        published: true,
      });
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

  // same as compose, but the proposed schemaSDL of the subgraph is not updated to the table so it is passed to the function
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

  /**
   * Applies the composition result to the database. That includes updating the composed schema of
   * the federated graph and the router config. It also stores the schema diff between the old and
   * the new schema as a changelog.
   */
  public async applyComposition(compositionResult: CompositionResult) {
    for await (const composedGraph of compositionResult.compositions) {
      const currentFederatedSDL = await this.federatedGraphRepo.getLatestSdlOfFederatedGraph(composedGraph.name);

      /**
       * Build router config when composed schema is valid
       */
      const hasErrors = composedGraph.errors.length > 0;

      let routerConfigJson: JsonValue = null;
      if (!hasErrors && composedGraph.composedSchema) {
        const routerConfig = buildRouterConfig({
          argumentConfigurations: composedGraph.argumentConfigurations,
          federatedSDL: composedGraph.composedSchema,
          subgraphs: composedGraph.subgraphs,
        });
        routerConfigJson = routerConfig.toJson();
      }

      // We always create a new version in the database, but
      // we might mark versions with compositions errors as not composable
      // The routerConfig is stored along with the valid composed schema
      const federatedGraph = await this.federatedGraphRepo.updateSchema({
        graphName: composedGraph.name,
        // passing the old schema if the current composed schema is empty due to composition errors
        composedSDL: composedGraph.composedSchema || currentFederatedSDL || undefined,
        compositionErrors: composedGraph.errors,
        routerConfig: routerConfigJson,
      });

      if (composedGraph.composedSchema && federatedGraph?.composedSchemaVersionId) {
        const schemaChanges = await getDiffBetweenGraphs(currentFederatedSDL || '', composedGraph.composedSchema);

        if (schemaChanges.kind !== 'failure') {
          await this.federatedGraphRepo.createFederatedGraphChangelog({
            schemaVersionID: federatedGraph.composedSchemaVersionId,
            changes: schemaChanges.changes,
          });
        }
      }
    }
  }
}
