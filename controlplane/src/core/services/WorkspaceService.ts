import { fromJson } from '@bufbuild/protobuf';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  WorkspaceNamespace,
  WorkspaceNamespaceSchema,
  WorkspaceFederatedGraphSchema,
  WorkspaceSubgraphSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq, inArray, SQL } from 'drizzle-orm';
import { PlainMessage } from '../../types/index.js';
import * as schema from '../../db/schema.js';
import { NamespaceRepository } from '../repositories/NamespaceRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { traced } from '../tracing.js';
import { RBACEvaluator } from './RBACEvaluator.js';

@traced
export class WorkspaceService {
  constructor(
    private organizationId: string,
    private rbac: RBACEvaluator,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getWorkspaceNamespaces(): Promise<PlainMessage<WorkspaceNamespace>[]> {
    const namespaceRepo = new NamespaceRepository(this.db, this.organizationId);

    // Step 1 - Retrieve all the namespaces the requesting actor have access to
    const namespaces = await namespaceRepo.list(this.rbac);
    if (namespaces.length === 0) {
      // The actor doesn't have access to any namespace, no need to continue
      return [];
    }

    // Step 2 - Initialize the response model and sort the namespaces alphabetically
    const result = namespaces
      .map((ns) =>
        fromJson(WorkspaceNamespaceSchema, {
          id: ns.id,
          name: ns.name,
          graphs: [],
          subgraphs: [],
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    // Step 3 - Retrieve all the subgraphs the actor has access to, based on the namespace
    await this.fetchSubgraphs(result);

    // Step 4 - Retrieve all the federated graphs the actor has access to, based on the namespaces
    await this.fetchFederatedGraphs(result);

    // Step 5 - Retrieve all the subgraphs the actor has access to, based on the federated graphs
    await this.fetchSubgraphsForFederatedGraphs(result);

    return result;
  }

  private async fetchSubgraphs(namespaces: PlainMessage<WorkspaceNamespace>[]): Promise<void> {
    if (namespaces.length === 0) {
      return;
    }

    const conditions: (SQL<unknown> | undefined)[] = [
      eq(schema.targets.type, 'subgraph'),
      eq(schema.targets.organizationId, this.organizationId),
      inArray(
        schema.targets.namespaceId,
        namespaces.map((ns) => ns.id),
      ),
    ];

    if (!SubgraphRepository.applyRbacConditionsToQuery(this.rbac, conditions)) {
      return;
    }

    const subgraphs = await this.db
      .select({
        id: schema.subgraphs.id,
        targetId: schema.targets.id,
        name: schema.targets.name,
        namespaceId: schema.targets.namespaceId,
        baseSubgraphId: schema.featureSubgraphsToBaseSubgraphs.baseSubgraphId,
        isFeatureSubgraph: schema.subgraphs.isFeatureSubgraph,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .leftJoin(
        schema.featureSubgraphsToBaseSubgraphs,
        eq(schema.featureSubgraphsToBaseSubgraphs.featureSubgraphId, schema.subgraphs.id),
      )
      .where(and(...conditions))
      .execute();

    for (const namespace of namespaces) {
      namespace.subgraphs = subgraphs
        .filter((fsg) => fsg.namespaceId === namespace.id)
        .map((fsg) =>
          fromJson(WorkspaceSubgraphSchema, {
            id: fsg.id,
            targetId: fsg.targetId,
            name: fsg.name,
            isFeatureSubgraph: fsg.isFeatureSubgraph,
            baseSubgraphId: fsg.baseSubgraphId,
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }
  }

  /**
   * Fetches all the federated graphs the actor has access to based on the provided namespaces.
   *
   * @private
   * @param namespaces The namespaces to fetch the federated graphs for
   */
  private async fetchFederatedGraphs(namespaces: PlainMessage<WorkspaceNamespace>[]): Promise<void> {
    const conditions: SQL<unknown>[] = [
      eq(schema.targets.type, 'federated'),
      eq(schema.targets.organizationId, this.organizationId),
      inArray(
        schema.targets.namespaceId,
        namespaces.map((ns) => ns.id),
      ),
    ];

    if (!FederatedGraphRepository.applyRbacConditionsToQuery(this.rbac, conditions)) {
      // The actor doesn't have access to any federated graph, no need to continue
      return;
    }

    // Retrieve the federated graphs from the database
    const federatedGraphs = await this.db
      .select({
        id: schema.federatedGraphs.id,
        targetId: schema.federatedGraphs.targetId,
        name: schema.targets.name,
        namespaceId: schema.targets.namespaceId,
        contractId: schema.contracts.id,
      })
      .from(schema.targets)
      .innerJoin(schema.federatedGraphs, eq(schema.federatedGraphs.targetId, schema.targets.id))
      .leftJoin(schema.contracts, eq(schema.contracts.downstreamFederatedGraphId, schema.federatedGraphs.id))
      .where(and(...conditions))
      .execute();

    // Map the federated graphs to the corresponding namespace
    for (const namespace of namespaces) {
      const namespaceGraphs = federatedGraphs.filter((graph) => graph.namespaceId === namespace.id);
      if (namespaceGraphs.length === 0) {
        continue;
      }

      namespace.graphs = namespaceGraphs
        .map((graph) =>
          fromJson(WorkspaceFederatedGraphSchema, {
            id: graph.id,
            targetId: graph.targetId,
            name: graph.name,
            isContract: !!graph.contractId,
            subgraphTargetIds: [],
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }
  }

  private async fetchSubgraphsForFederatedGraphs(namespaces: PlainMessage<WorkspaceNamespace>[]): Promise<void> {
    const federatedGraphIds = namespaces.flatMap((ns) => ns.graphs.map((graph) => graph.id));
    if (federatedGraphIds.length === 0) {
      return;
    }

    const conditions: (SQL<unknown> | undefined)[] = [
      eq(schema.targets.organizationId, this.organizationId),
      eq(schema.targets.type, 'subgraph'),
      eq(schema.subgraphs.isFeatureSubgraph, false),
      inArray(schema.subgraphsToFederatedGraph.federatedGraphId, federatedGraphIds),
    ];

    if (!SubgraphRepository.applyRbacConditionsToQuery(this.rbac, conditions)) {
      return;
    }

    const targetSubgraphs = await this.db
      .selectDistinct({
        targetId: schema.targets.id,
        federatedGraphId: schema.subgraphsToFederatedGraph.federatedGraphId,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .innerJoin(schema.subgraphsToFederatedGraph, eq(schema.subgraphsToFederatedGraph.subgraphId, schema.subgraphs.id))
      .where(and(...conditions))
      .execute();

    for (const ns of namespaces) {
      for (const graph of ns.graphs) {
        const subgraphs = targetSubgraphs.filter((sg) => sg.federatedGraphId === graph.id);
        if (subgraphs.length === 0) {
          continue;
        }

        graph.subgraphTargetIds = subgraphs
          .map((sg) => ns.subgraphs.find((nssg) => nssg.targetId === sg.targetId)!)
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
          .map((sg) => sg.targetId);
      }
    }
  }
}
