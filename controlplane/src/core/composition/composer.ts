import { randomUUID } from 'node:crypto';
import { DocumentNode, parse, printSchema } from 'graphql';
import { JsonValue } from '@bufbuild/protobuf';
import { buildRouterConfig, ComposedSubgraph } from '@wundergraph/cosmo-shared';
import { ArgumentConfigurationData, FederationResult } from '@wundergraph/composition';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { FederatedGraphDTO, Label, SubgraphDTO } from '../../types/index.js';
import { GraphCompositionRepository } from '../repositories/GraphCompositionRepository.js';
import { BlobStorage } from '../blobstorage/index.js';
import { composeSubgraphs } from './composition.js';
import { getDiffBetweenGraphs } from './schemaCheck.js';

export type CompositionResult = {
  compositions: ComposedFederatedGraph[];
};

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
      schemaVersionId: subgraph.schemaVersionId,
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
  namespace: string;
  composedSchema?: string;
  errors: Error[];
  subgraphs: ComposedSubgraph[];
  argumentConfigurations: ArgumentConfigurationData[];
}

export class Composer {
  constructor(
    private federatedGraphRepo: FederatedGraphRepository,
    private subgraphRepo: SubgraphRepository,
    private compositionRepo: GraphCompositionRepository,
  ) {}

  /**
   * Build and store the final router config and federated schema to the database. A diff between the
   * previous and current schema is stored as changelog.
   */
  async deployComposition({
    composedGraph,
    composedBy,
    blobStorage,
    organizationId,
  }: {
    composedGraph: ComposedFederatedGraph;
    composedBy: string;
    blobStorage: BlobStorage;
    organizationId: string;
  }) {
    const hasCompositionErrors = composedGraph.errors.length > 0;
    const federatedSchemaVersionId = randomUUID();

    let routerConfigJson: JsonValue = null;
    const path = `${organizationId}/${composedGraph.id}/routerconfigs/latest.json`;

    // Build router config when composed schema is valid
    if (!hasCompositionErrors && composedGraph.composedSchema) {
      const routerConfig = buildRouterConfig({
        argumentConfigurations: composedGraph.argumentConfigurations,
        subgraphs: composedGraph.subgraphs,
        federatedSDL: composedGraph.composedSchema,
        schemaVersionId: federatedSchemaVersionId,
      });
      routerConfigJson = routerConfig.toJson();

      try {
        await blobStorage.putObject({
          key: path,
          body: Buffer.from(routerConfig.toJsonString(), 'utf8'),
          contentType: 'application/json; charset=utf-8',
          version: federatedSchemaVersionId,
        });
      } catch {
        throw new Error(
          `Could not upload the latest config of the federated graph ${composedGraph.name}. Please try again.`,
        );
      }
    }

    const prevValidFederatedSDL = await this.federatedGraphRepo.getLatestValidSchemaVersion({
      targetId: composedGraph.targetID,
    });

    const updatedFederatedGraph = await this.federatedGraphRepo.addSchemaVersion({
      targetId: composedGraph.targetID,
      composedSDL: composedGraph.composedSchema,
      subgraphSchemaVersionIds: composedGraph.subgraphs.map((s) => s.schemaVersionId!),
      compositionErrors: composedGraph.errors,
      routerConfig: routerConfigJson,
      composedBy,
      schemaVersionId: federatedSchemaVersionId,
      // passing the path only when there exists a previous valid version or when the compostion passes.
      routerConfigPath: prevValidFederatedSDL || (!hasCompositionErrors && composedGraph.composedSchema) ? path : null,
    });

    // Only create changelog when the composed schema is valid
    if (!hasCompositionErrors && composedGraph.composedSchema && updatedFederatedGraph?.composedSchemaVersionId) {
      const schemaChanges = await getDiffBetweenGraphs(
        prevValidFederatedSDL?.schema || '',
        composedGraph.composedSchema,
      );

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
      const subgraphs = await this.subgraphRepo.listByFederatedGraph({
        federatedGraphTargetId: federatedGraph.targetId,
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
        namespace: federatedGraph.namespace,
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
        namespace: federatedGraph.namespace,
        targetID: federatedGraph.targetId,
        argumentConfigurations: [],
        errors: [e],
        subgraphs: [],
      };
    }
  }

  protected async composeWithLabels(
    subgraphLabels: Label[],
    namespace: string,
    mapSubgraphs: (
      subgraphs: SubgraphDTO[],
    ) => [SubgraphDTO[], { name: string; url: string; definitions: DocumentNode }[]],
  ): Promise<CompositionResult> {
    const composedGraphs: ComposedFederatedGraph[] = [];

    for await (const graph of await this.federatedGraphRepo.bySubgraphLabels(subgraphLabels, namespace)) {
      try {
        const [subgraphs, subgraphsToBeComposed] = mapSubgraphs(
          await this.subgraphRepo.listByFederatedGraph({ federatedGraphTargetId: graph.targetId }),
        );

        const { errors, federationResult: result } = composeSubgraphs(subgraphsToBeComposed);
        composedGraphs.push({
          id: graph.id,
          name: graph.name,
          namespace: graph.namespace,
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
          namespace: graph.namespace,
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

  /**
   * Same as compose, but the proposed schemaSDL of the subgraph is not updated to the table, so it is passed to the function
   */
  composeWithProposedSDL(subgraphLabels: Label[], subgraphName: string, namespace: string, subgraphSchemaSDL: string) {
    return this.composeWithLabels(subgraphLabels, namespace, (subgraphs) => {
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

      return [subgraphs, subgraphsToBeComposed];
    });
  }

  composeWithDeletedSubgraph(subgraphLabels: Label[], subgraphName: string, namespace: string) {
    return this.composeWithLabels(subgraphLabels, namespace, (subgraphs) => {
      const subgraphsToBeComposed = [];

      const filteredSubgraphs = subgraphs.filter((s) => s.name !== subgraphName);

      for (const subgraph of subgraphs) {
        if (subgraph.name !== subgraphName && subgraph.schemaSDL !== '') {
          subgraphsToBeComposed.push({
            name: subgraph.name,
            url: subgraph.routingUrl,
            definitions: parse(subgraph.schemaSDL),
          });
        }
      }

      return [filteredSubgraphs, subgraphsToBeComposed];
    });
  }
}
