import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ProposalState } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import { ProposalDTO, ProposalSubgraphDTO } from '../../types/index.js';

/**
 * Repository for organization related operations.
 */
export class ProposalRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async createProposal({
    federatedGraphId,
    name,
    userId,
    proposalSubgraphs,
    didHubCreate,
  }: {
    federatedGraphId: string;
    name: string;
    userId: string;
    proposalSubgraphs: {
      subgraphId?: string;
      subgraphName: string;
      schemaSDL: string;
      isDeleted: boolean;
    }[];
    didHubCreate: boolean;
  }): Promise<ProposalDTO> {
    const proposal = await this.db
      .insert(schema.proposals)
      .values({
        federatedGraphId,
        name,
        createdById: userId,
        state: 'DRAFT',
        didHubCreate,
      })
      .returning();

    await this.db.insert(schema.proposalSubgraphs).values(
      proposalSubgraphs.map((subgraph) => ({
        proposalId: proposal[0].id,
        subgraphId: subgraph.subgraphId,
        subgraphName: subgraph.subgraphName,
        schemaSDL: subgraph.schemaSDL || null,
        isDeleted: subgraph.isDeleted,
      })),
    );

    return {
      id: proposal[0].id,
      name: proposal[0].name,
      createdAt: proposal[0].createdAt.toISOString(),
      createdById: proposal[0].createdById || '',
      state: proposal[0].state,
      federatedGraphId: proposal[0].federatedGraphId,
    };
  }

  public async ById(
    id: string,
  ): Promise<{ proposal: ProposalDTO; proposalSubgraphs: ProposalSubgraphDTO[] } | undefined> {
    const proposal = await this.db
      .select({
        id: schema.proposals.id,
        name: schema.proposals.name,
        createdAt: schema.proposals.createdAt,
        createdById: schema.proposals.createdById,
        createdByEmail: schema.users.email,
        state: schema.proposals.state,
        federatedGraphId: schema.proposals.federatedGraphId,
      })
      .from(schema.proposals)
      .leftJoin(schema.users, eq(schema.proposals.createdById, schema.users.id))
      .where(eq(schema.proposals.id, id));

    const proposalSubgraphs = await this.db
      .select({
        id: schema.proposalSubgraphs.id,
        subgraphId: schema.proposalSubgraphs.subgraphId,
        subgraphName: schema.proposalSubgraphs.subgraphName,
        schemaSDL: schema.proposalSubgraphs.schemaSDL,
        isDeleted: schema.proposalSubgraphs.isDeleted,
      })
      .from(schema.proposalSubgraphs)
      .where(eq(schema.proposalSubgraphs.proposalId, id));

    if (proposal.length === 0) {
      return undefined;
    }
    return {
      proposal: {
        id: proposal[0].id,
        name: proposal[0].name,
        createdAt: proposal[0].createdAt.toISOString(),
        createdById: proposal[0].createdById || '',
        createdByEmail: proposal[0].createdByEmail || '',
        state: proposal[0].state,
        federatedGraphId: proposal[0].federatedGraphId,
      },
      proposalSubgraphs: proposalSubgraphs.map((subgraph) => ({
        id: subgraph.id,
        subgraphId: subgraph.subgraphId || undefined,
        subgraphName: subgraph.subgraphName,
        schemaSDL: subgraph.schemaSDL || '',
        isDeleted: subgraph.isDeleted,
      })),
    };
  }

  public async ByFederatedGraphId(
    federatedGraphId: string,
  ): Promise<{ proposals: { proposal: ProposalDTO; proposalSubgraphs: ProposalSubgraphDTO[] }[] }> {
    const proposalsWithSubgraphs: { proposal: ProposalDTO; proposalSubgraphs: ProposalSubgraphDTO[] }[] = [];
    const proposals = await this.db
      .select({
        id: schema.proposals.id,
        name: schema.proposals.name,
        createdAt: schema.proposals.createdAt,
        createdById: schema.proposals.createdById,
        createdByEmail: schema.users.email,
        state: schema.proposals.state,
        federatedGraphId: schema.proposals.federatedGraphId,
      })
      .from(schema.proposals)
      .leftJoin(schema.users, eq(schema.proposals.createdById, schema.users.id))
      .where(eq(schema.proposals.federatedGraphId, federatedGraphId));

    if (proposals.length === 0) {
      return {
        proposals: [],
      };
    }

    for (const proposal of proposals) {
      const proposalSubgraphs = await this.db
        .select({
          id: schema.proposalSubgraphs.id,
          subgraphId: schema.proposalSubgraphs.subgraphId,
          subgraphName: schema.proposalSubgraphs.subgraphName,
          schemaSDL: schema.proposalSubgraphs.schemaSDL,
          isDeleted: schema.proposalSubgraphs.isDeleted,
        })
        .from(schema.proposalSubgraphs)
        .where(eq(schema.proposalSubgraphs.proposalId, proposal.id));

      proposalsWithSubgraphs.push({
        proposal: {
          id: proposal.id,
          name: proposal.name,
          createdAt: proposal.createdAt.toISOString(),
          createdById: proposal.createdById || '',
          createdByEmail: proposal.createdByEmail || '',
          state: proposal.state,
          federatedGraphId: proposal.federatedGraphId,
        },
        proposalSubgraphs: proposalSubgraphs.map((subgraph) => ({
          id: subgraph.id,
          subgraphId: subgraph.subgraphId || undefined,
          subgraphName: subgraph.subgraphName,
          schemaSDL: subgraph.schemaSDL || '',
          isDeleted: subgraph.isDeleted,
        })),
      });
    }

    return {
      proposals: proposalsWithSubgraphs,
    };
  }

  public async updateProposal({
    id,
    state,
    proposalSubgraphs,
  }: {
    id: string;
    state: ProposalState;
    proposalSubgraphs: {
      subgraphId?: string;
      subgraphName: string;
      schemaSDL: string;
      isDeleted: boolean;
    }[];
  }): Promise<ProposalDTO> {
    const proposal = await this.db
      .update(schema.proposals)
      .set({
        state,
      })
      .where(eq(schema.proposals.id, id))
      .returning();

    await this.db.delete(schema.proposalSubgraphs).where(eq(schema.proposalSubgraphs.proposalId, id));

    await this.db.insert(schema.proposalSubgraphs).values(
      proposalSubgraphs.map((subgraph) => ({
        proposalId: proposal[0].id,
        subgraphId: subgraph.subgraphId,
        subgraphName: subgraph.subgraphName,
        schemaSDL: subgraph.schemaSDL || null,
        isDeleted: subgraph.isDeleted,
      })),
    );

    return {
      id: proposal[0].id,
      name: proposal[0].name,
      createdAt: proposal[0].createdAt.toISOString(),
      createdById: proposal[0].createdById || '',
      state: proposal[0].state,
      federatedGraphId: proposal[0].federatedGraphId,
    };
  }
}
