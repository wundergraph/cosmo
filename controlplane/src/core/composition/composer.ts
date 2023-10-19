import { parse, printSchema } from 'graphql';
import { ArgumentConfigurationData } from '@wundergraph/composition';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { Label } from '../../types/index.js';
import { composeSubgraphs } from './composition.js';

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

  async composeFederatedGraph(name: string, targetID: string): Promise<ComposedFederatedGraph> {
    try {
      const subgraphs = await this.subgraphRepo.listByGraph(name, {
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

  // same as compose, but the proposed schemaSDL of the subgraph is not updated to the table so it is passed to the function
  async composeWithProposedSDL(
    subgraphLabels: Label[],
    subgraphName: string,
    subgraphSchemaSDL: string,
  ): Promise<CompositionResult> {
    const composedGraphs: ComposedFederatedGraph[] = [];

    for await (const graph of await this.federatedGraphRepo.bySubgraphLabels(subgraphLabels)) {
      try {
        const subgraphs = await this.subgraphRepo.listByGraph(graph.name);
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
