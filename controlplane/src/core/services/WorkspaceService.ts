import { PlainMessage } from '@bufbuild/protobuf';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  WorkspaceNamespace,
  WorkspaceFederatedGraph,
  WorkspaceSubgraph,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, eq, inArray, SQL } from 'drizzle-orm';
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
        WorkspaceNamespace.fromJson({
          id: ns.id,
          name: ns.name,
          graphs: [],
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    // Step 2 - Retrieve all the federated graphs the actor has access to, based on the namespaces
    const federatedGraphs = await this.fetchFederatedGraphs(result);
    if (federatedGraphs === 0) {
      return result;
    }

    // Step 3 - Retrieve all the subgraphs the actor has access to, based on the federated graphs
    await this.fetchSubgraphsForFederatedGraphs(result);

    return result;
  }

  /**
   * Fetches all the federated graphs the actor has access to based on the provided namespaces.
   *
   * @private
   * @param namespaces The namespaces to fetch the federated graphs for
   * @returns The number of federated graphs fetched
   */
  private async fetchFederatedGraphs(namespaces: PlainMessage<WorkspaceNamespace>[]): Promise<number> {
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
      return 0;
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
    let numberOfFetchedGraphs = 0;
    for (const namespace of namespaces) {
      const namespaceGraphs = federatedGraphs.filter((graph) => graph.namespaceId === namespace.id);
      if (namespaceGraphs.length === 0) {
        continue;
      }

      numberOfFetchedGraphs += namespaceGraphs.length;
      namespace.graphs = namespaceGraphs
        .map((graph) =>
          WorkspaceFederatedGraph.fromJson({
            id: graph.id,
            targetId: graph.targetId,
            name: graph.name,
            isContract: !!graph.contractId,
            subgraphs: [],
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    return numberOfFetchedGraphs;
  }

  private async fetchSubgraphsForFederatedGraphs(namespaces: PlainMessage<WorkspaceNamespace>[]): Promise<void> {
    const conditions: (SQL<unknown> | undefined)[] = [
      eq(schema.targets.organizationId, this.organizationId),
      eq(schema.targets.type, 'subgraph'),
      inArray(
        schema.subgraphsToFederatedGraph.federatedGraphId,
        namespaces.flatMap((ns) => ns.graphs.map((graph) => graph.id)),
      ),
    ];

    if (!SubgraphRepository.applyRbacConditionsToQuery(this.rbac, conditions)) {
      return;
    }

    const a = await this.db
      .selectDistinct({
        id: schema.subgraphs.id,
        targetId: schema.targets.id,
        federatedGraphId: schema.subgraphsToFederatedGraph.federatedGraphId,
        name: schema.targets.name,
      })
      .from(schema.targets)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .innerJoin(schema.subgraphsToFederatedGraph, eq(schema.subgraphsToFederatedGraph.subgraphId, schema.subgraphs.id))
      .where(and(...conditions))
      .execute();

    const federatedGraphs = namespaces.flatMap((ns) => ns.graphs);
    for (const graph of federatedGraphs) {
      const subgraphs = a.filter((sg) => sg.federatedGraphId === graph.id);
      if (subgraphs.length === 0) {
        continue;
      }

      graph.subgraphs = subgraphs
        .map((sg) =>
          WorkspaceSubgraph.fromJson({
            id: sg.id,
            targetId: sg.targetId,
            name: sg.name,
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }
  }
}
