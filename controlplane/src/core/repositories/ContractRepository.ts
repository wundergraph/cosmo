import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { FederatedGraphDTO } from '../../types/index.js';
import { contracts, federatedGraphs, targets } from '../../db/schema.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { TargetRepository } from './TargetRepository.js';

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
    includeTags: string[];
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

  public update(data: {
    id: string;
    excludeTags: string[];
    includeTags: string[];
    actorId: string;
    targetId: string;
    readme?: string;
  }) {
    return this.db.transaction(async (tx) => {
      const targetRepo = new TargetRepository(tx, this.organizationId);

      const res = await tx
        .update(schema.contracts)
        .set({
          excludeTags: data.excludeTags,
          includeTags: data.includeTags,
          updatedById: data.actorId,
          updatedAt: new Date(),
        })
        .where(eq(schema.contracts.id, data.id))
        .returning();

      if (data.readme !== undefined) {
        await targetRepo.updateReadmeOfTarget({ id: data.targetId, readme: data.readme });
      }

      return res[0];
    });
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
            includeTags: true,
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
