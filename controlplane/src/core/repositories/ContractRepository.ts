import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { federateSubgraphsContract } from '@wundergraph/composition';
import { parse } from 'graphql';
import * as schema from '../../db/schema.js';
import { Composer, CompositionDeployResult, mapResultToComposedGraph } from '../composition/composer.js';
import { BlobStorage } from '../blobstorage/index.js';
import { composeSubgraphsForContract } from '../composition/composition.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { GraphCompositionRepository } from './GraphCompositionRepository.js';
import { FederatedGraphDTO } from 'src/types/index.js';

export class ContractRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async create(data: {
    sourceFederatedGraphId: string;
    downstreamFederatedGraphId: string;
    excludeTags: string[];
    actorId: string;
  }) {
    const res = await this.db
      .insert(schema.contracts)
      .values({
        ...data,
        createdById: data.actorId,
      })
      .returning();

    return res[0];
  }

  public async update(data: { id: string; excludeTags: string[]; actorId: string }) {
    const res = await this.db
      .update(schema.contracts)
      .set({
        excludeTags: data.excludeTags,
        updatedById: data.actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.contracts.id, data.id))
      .returning();

    return res[0];
  }

  public delete(id: string) {
    return this.db.delete(schema.contracts).where(eq(schema.contracts.id, id)).returning();
  }

  public async bySourceFederatedGraphId(id: string) {
    const res = await this.db.query.federatedGraphs.findFirst({
      where: eq(schema.federatedGraphs.id, id),
      columns: {
        id: true,
      },
      with: {
        contracts: {
          columns: {
            id: true,
            sourceFederatedGraphId: true,
            downstreamFederatedGraphId: true,
            excludeTags: true,
          },
          with: {
            downstreamFederatedGraph: {
              with: {
                target: true,
              },
            },
          },
        },
      },
    });

    return res?.contracts ?? [];
  }

  public deployContract({
    contractGraph,
    actorId,
    blobStorage,
    admissionConfig,
  }: {
    contractGraph: FederatedGraphDTO;
    actorId: string;
    blobStorage: BlobStorage;
    admissionConfig: {
      jwtSecret: string;
      cdnBaseUrl: string;
    };
  }): Promise<{ contractErrors: Error[]; deployment?: CompositionDeployResult }> {
    return this.db.transaction(async (tx) => {
      const contractErrors: Error[] = [];

      const fedGraphRepo = new FederatedGraphRepository(this.logger, tx, this.organizationId);
      const subgraphRepo = new SubgraphRepository(this.logger, tx, this.organizationId);
      const compositionRepo = new GraphCompositionRepository(this.logger, tx);
      const contractRepo = new ContractRepository(this.logger, tx, this.organizationId);

      if (!contractGraph.contract?.sourceFederatedGraphId) {
        return { contractErrors };
      }

      const sourceGraph = await fedGraphRepo.byId(contractGraph.contract.sourceFederatedGraphId);
      if (!sourceGraph) {
        throw new Error(`Could not find source graph ${contractGraph.contract.sourceFederatedGraphId}`);
      }

      const sourceGraphLatestValidRouterConfig = await fedGraphRepo.getLatestValidRouterConfig(sourceGraph.targetId);
      if (!sourceGraphLatestValidRouterConfig) {
        return { contractErrors };
      }

      const composition = await compositionRepo.getGraphCompositionBySchemaVersion({
        schemaVersionId: sourceGraphLatestValidRouterConfig.schemaVersionId,
        organizationId: this.organizationId,
      });

      if (!composition) {
        return { contractErrors };
      }

      const subgraphs = await compositionRepo.getCompositionSubgraphs({
        compositionId: composition.id,
      });

      const { errors, federationResult: result } = composeSubgraphsForContract(
        subgraphs.map((s) => ({
          name: s.name,
          url: s.routingUrl,
          definitions: parse(s.schemaSDL),
        })),
        new Set(contractGraph.contract.excludeTags),
      );

      contractErrors.push(...(errors || []));

      const composer = new Composer(this.logger, fedGraphRepo, subgraphRepo, contractRepo);
      const deployment = await composer.deployComposition({
        composedGraph: mapResultToComposedGraph(contractGraph, subgraphs, errors, result),
        composedBy: actorId,
        blobStorage,
        organizationId: this.organizationId,
        admissionWebhookURL: contractGraph.admissionWebhookURL,
        admissionConfig,
      });

      return { deployment, contractErrors };
    });
  }

  public deleteContractGraphs(sourceGraphId: string) {
    return this.db.transaction(async (tx) => {
      const deletedGraphs: FederatedGraphDTO[] = [];

      const contractRepo = new ContractRepository(this.logger, tx, this.organizationId);
      const fedGraphRepo = new FederatedGraphRepository(this.logger, tx, this.organizationId);

      const contracts = await contractRepo.bySourceFederatedGraphId(sourceGraphId);
      for (const contract of contracts) {
        const contractGraph = await fedGraphRepo.byId(contract.downstreamFederatedGraphId);
        if (!contractGraph) {
          continue;
        }

        await fedGraphRepo.delete(contractGraph.targetId);
        deletedGraphs.push(contractGraph);
      }

      return deletedGraphs;
    });
  }
}
