import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FederatedGraphDTO } from 'src/types/index.js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { Composer, CompositionDeployResult } from '../composition/composer.js';
import { BlobStorage } from '../blobstorage/index.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { SubgraphRepository } from './SubgraphRepository.js';
import { GraphCompositionRepository } from './GraphCompositionRepository.js';

export class ContractRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public create(data: {
    sourceFederatedGraphId: string;
    downstreamFederatedGraphId: string;
    includeTags: string[];
    excludeTags: string[];
    actorId: string;
  }) {
    return this.db
      .insert(schema.contracts)
      .values({
        ...data,
        createdById: data.actorId,
      })
      .returning();
  }

  public async update(data: { id: string; includeTags: string[]; excludeTags: string[]; actorId: string }) {
    const res = await this.db
      .update(schema.contracts)
      .set({
        includeTags: data.includeTags,
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
            includeTags: true,
            excludeTags: true,
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
  }): Promise<CompositionDeployResult | undefined> {
    return this.db.transaction(async (tx) => {
      const fedGraphRepo = new FederatedGraphRepository(this.logger, tx, this.organizationId);
      const subgraphRepo = new SubgraphRepository(this.logger, tx, this.organizationId);
      const compositionRepo = new GraphCompositionRepository(this.logger, tx);

      const sourceGraph = await fedGraphRepo.byId(contractGraph.contract!.sourceFederatedGraphId);
      if (!sourceGraph) {
        throw new Error(`Could not find source graph ${contractGraph.contract?.sourceFederatedGraphId}`);
      }

      const sourceGraphLatestValidRouterConfig = await fedGraphRepo.getLatestValidRouterConfig(sourceGraph.targetId);
      if (!sourceGraphLatestValidRouterConfig) {
        return;
      }

      const sourceGraphLatestValidSDL = fedGraphRepo.getSdlBasedOnSchemaVersion({
        targetId: sourceGraph.targetId,
        schemaVersionId: sourceGraphLatestValidRouterConfig.schemaVersionId,
      });
      if (!sourceGraphLatestValidSDL) {
        return;
      }

      const composer = new Composer(this.logger, fedGraphRepo, subgraphRepo);

      // TODO
      // Perform tag filter operations
      // const filteredSchema = filter(sourceGraphLatestValidSDL)
      const filteredSchema = `type Query {}`;

      const composition = await compositionRepo.getGraphCompositionBySchemaVersion({
        schemaVersionId: sourceGraphLatestValidRouterConfig.schemaVersionId,
        organizationId: this.organizationId,
      });

      if (!composition) {
        return;
      }

      const subgraphs = await compositionRepo.getCompositionSubgraphs({
        compositionId: composition.id,
      });

      const deployment = await composer.deployComposition({
        composedGraph: {
          id: contractGraph.id,
          targetID: contractGraph.targetId,
          name: contractGraph.name,
          namespace: contractGraph.namespace,
          namespaceId: contractGraph.namespaceId,
          composedSchema: filteredSchema,
          errors: [],
          subgraphs: subgraphs.map((s) => ({
            id: s.id,
            name: s.name,
            schemaVersionId: s.schemaVersionId,
            sdl: s.schemaSDL,
            url: s.routingUrl,
            subscriptionUrl: s.subscriptionUrl,
            subscriptionProtocol: s.subscriptionProtocol,
          })),
          // Not required since we do not rebuild router config
          fieldConfigurations: [],
        },
        composedBy: actorId,
        blobStorage,
        organizationId: this.organizationId,
        admissionWebhookURL: contractGraph.admissionWebhookURL,
        admissionConfig,
        // Pass this so that router config is not rebuilt.
        contractRouterConfig: sourceGraphLatestValidRouterConfig.config,
      });

      return deployment;
    });
  }
}
