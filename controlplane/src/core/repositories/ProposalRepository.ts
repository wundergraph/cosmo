import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ProposalState } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import { GetChecksResponse, LintSeverityLevel, ProposalDTO, ProposalSubgraphDTO } from '../../types/index.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';
import { SchemaCheckRepository } from './SchemaCheckRepository.js';

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
      isNew: boolean;
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
        isNew: subgraph.isNew,
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

  public async ByName({
    name,
    federatedGraphId,
  }: {
    name: string;
    federatedGraphId: string;
  }): Promise<{ proposal: ProposalDTO; proposalSubgraphs: ProposalSubgraphDTO[] } | undefined> {
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
      .where(and(eq(schema.proposals.name, name), eq(schema.proposals.federatedGraphId, federatedGraphId)));

    if (proposal.length === 0) {
      return undefined;
    }

    const proposalSubgraphs = await this.db
      .select({
        id: schema.proposalSubgraphs.id,
        subgraphId: schema.proposalSubgraphs.subgraphId,
        subgraphName: schema.proposalSubgraphs.subgraphName,
        schemaSDL: schema.proposalSubgraphs.schemaSDL,
        isDeleted: schema.proposalSubgraphs.isDeleted,
      })
      .from(schema.proposalSubgraphs)
      .where(eq(schema.proposalSubgraphs.proposalId, proposal[0].id));

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
    state?: ProposalState;
    proposalSubgraphs: {
      subgraphId?: string;
      subgraphName: string;
      schemaSDL: string;
      isDeleted: boolean;
      isNew: boolean;
    }[];
  }) {
    if (state) {
      await this.db
        .update(schema.proposals)
        .set({
          state,
        })
        .where(eq(schema.proposals.id, id))
        .returning();
    } else {
      await this.db.delete(schema.proposalSubgraphs).where(eq(schema.proposalSubgraphs.proposalId, id));

      await this.db.insert(schema.proposalSubgraphs).values(
        proposalSubgraphs.map((subgraph) => ({
          proposalId: id,
          subgraphId: subgraph.subgraphId,
          subgraphName: subgraph.subgraphName,
          schemaSDL: subgraph.schemaSDL || null,
          isDeleted: subgraph.isDeleted,
          isNew: subgraph.isNew,
        })),
      );
    }
  }

  public async configureProposalConfig({
    namespaceId,
    checkSeverityLevel,
    publishSeverityLevel,
  }: {
    namespaceId: string;
    checkSeverityLevel: LintSeverityLevel;
    publishSeverityLevel: LintSeverityLevel;
  }) {
    await this.db
      .insert(schema.namespaceProposalConfig)
      .values({
        namespaceId,
        checkSeverityLevel,
        publishSeverityLevel,
      })
      .onConflictDoUpdate({
        target: schema.namespaceProposalConfig.namespaceId,
        set: {
          checkSeverityLevel,
          publishSeverityLevel,
        },
      });
  }

  public async deleteProposalConfig({ namespaceId }: { namespaceId: string }) {
    await this.db
      .delete(schema.namespaceProposalConfig)
      .where(eq(schema.namespaceProposalConfig.namespaceId, namespaceId));
  }

  public async getProposalConfig({ namespaceId }: { namespaceId: string }) {
    const proposalConfig = await this.db
      .select({
        checkSeverityLevel: schema.namespaceProposalConfig.checkSeverityLevel,
        publishSeverityLevel: schema.namespaceProposalConfig.publishSeverityLevel,
      })
      .from(schema.namespaceProposalConfig)
      .where(eq(schema.namespaceProposalConfig.namespaceId, namespaceId));

    if (proposalConfig.length === 0) {
      return;
    }

    return proposalConfig[0];
  }

  public async getApprovedProposalSubgraphsBySubgraphId({ subgraphId }: { subgraphId: string }) {
    const proposalSubgraphs = await this.db
      .select({
        id: schema.proposalSubgraphs.id,
        proposalId: schema.proposalSubgraphs.proposalId,
        proposedSchemaSDL: schema.proposalSubgraphs.schemaSDL,
      })
      .from(schema.proposalSubgraphs)
      .innerJoin(schema.proposals, eq(schema.proposalSubgraphs.proposalId, schema.proposals.id))
      .where(and(eq(schema.proposalSubgraphs.subgraphId, subgraphId), eq(schema.proposals.state, 'APPROVED')));

    return proposalSubgraphs;
  }

  public async matchSchemaWithProposal({
    subgraphId,
    schemaCheckId,
    schemaSDL,
    routerCompatibilityVersion,
  }: {
    subgraphId: string;
    schemaCheckId?: string;
    schemaSDL: string;
    routerCompatibilityVersion: string;
  }): Promise<{ proposalId: string; proposalSubgraphId: string } | undefined> {
    const proposalSubgraphs = await this.getApprovedProposalSubgraphsBySubgraphId({ subgraphId });

    for (const proposalSubgraph of proposalSubgraphs) {
      if (!proposalSubgraph.proposedSchemaSDL) {
        continue;
      }
      const proposedSchema = proposalSubgraph.proposedSchemaSDL;
      const schemaChanges = await getDiffBetweenGraphs(schemaSDL, proposedSchema, routerCompatibilityVersion);
      if (schemaChanges.kind === 'failure') {
        continue;
      }

      if (schemaCheckId) {
        await this.db
          .insert(schema.schemaCheckProposalMatch)
          .values({
            proposalId: proposalSubgraph.proposalId,
            proposalMatch: schemaChanges.changes.length === 0,
            schemaCheckId,
          })
          .onConflictDoUpdate({
            target: [schema.schemaCheckProposalMatch.schemaCheckId, schema.schemaCheckProposalMatch.proposalId],
            set: {
              proposalMatch: schemaChanges.changes.length === 0,
            },
          });
      }

      if (schemaChanges.changes.length === 0) {
        return {
          proposalId: proposalSubgraph.proposalId,
          proposalSubgraphId: proposalSubgraph.id,
        };
      }
    }
    return undefined;
  }

  public async getLatestCheckForProposal(
    proposalId: string,
  ): Promise<{ checkId: string; isSuccessful: boolean } | null> {
    const latestCheck = await this.db
      .select({
        schemaCheckId: schema.schemaCheckProposals.schemaCheckId,
      })
      .from(schema.schemaCheckProposals)
      .where(eq(schema.schemaCheckProposals.proposalId, proposalId))
      .orderBy(desc(schema.schemaCheckProposals.createdAt))
      .limit(1);

    if (latestCheck.length === 0) {
      return null;
    }

    const check = await this.db
      .select({
        id: schema.schemaChecks.id,
        isComposable: schema.schemaChecks.isComposable,
        isBreaking: schema.schemaChecks.hasBreakingChanges,
        hasClientTraffic: schema.schemaChecks.hasClientTraffic,
        hasLintErrors: schema.schemaChecks.hasLintErrors,
        hasGraphPruningErrors: schema.schemaChecks.hasGraphPruningErrors,
        clientTrafficCheckSkipped: schema.schemaChecks.clientTrafficCheckSkipped,
      })
      .from(schema.schemaChecks)
      .where(eq(schema.schemaChecks.id, latestCheck[0].schemaCheckId))
      .limit(1);

    if (check.length === 0) {
      return null;
    }

    // Apply the same logic as isCheckSuccessful helper function
    const isComposable = Boolean(check[0].isComposable);
    const isBreaking = Boolean(check[0].isBreaking);
    const hasClientTraffic = Boolean(check[0].hasClientTraffic);
    const hasLintErrors = Boolean(check[0].hasLintErrors);
    const hasGraphPruningErrors = Boolean(check[0].hasGraphPruningErrors);
    const clientTrafficCheckSkipped = Boolean(check[0].clientTrafficCheckSkipped);

    const isSuccessful =
      isComposable &&
      (!isBreaking || (isBreaking && !hasClientTraffic && !clientTrafficCheckSkipped)) &&
      !hasLintErrors &&
      !hasGraphPruningErrors;

    return {
      checkId: check[0].id,
      isSuccessful,
    };
  }

  public async getChecksByProposalId({
    proposalId,
    federatedGraphId,
    limit,
    offset,
    startDate,
    endDate,
  }: {
    proposalId: string;
    federatedGraphId: string;
    limit: number;
    offset: number;
    startDate?: string;
    endDate?: string;
  }): Promise<GetChecksResponse> {
    let whereCondition: any = eq(schema.schemaCheckProposals.proposalId, proposalId);

    if (startDate && endDate) {
      whereCondition = and(
        whereCondition,
        gt(schema.schemaCheckProposals.createdAt, new Date(startDate)),
        lt(schema.schemaCheckProposals.createdAt, new Date(endDate)),
      );
    }

    const checksList = await this.db
      .select({
        id: schema.schemaChecks.id,
        createdAt: schema.schemaChecks.createdAt,
        isComposable: schema.schemaChecks.isComposable,
        hasBreakingChanges: schema.schemaChecks.hasBreakingChanges,
        hasClientTraffic: schema.schemaChecks.hasClientTraffic,
        forcedSuccess: schema.schemaChecks.forcedSuccess,
        hasLintErrors: schema.schemaChecks.hasLintErrors,
        hasGraphPruningErrors: schema.schemaChecks.hasGraphPruningErrors,
        clientTrafficCheckSkipped: schema.schemaChecks.clientTrafficCheckSkipped,
        lintSkipped: schema.schemaChecks.lintSkipped,
        graphPruningSkipped: schema.schemaChecks.graphPruningSkipped,
        ghDetails: schema.schemaChecks.ghDetails,
        isDeleted: schema.schemaChecks.isDeleted,
        proposalMatch: schema.schemaChecks.proposalMatch,
      })
      .from(schema.schemaCheckProposals)
      .innerJoin(schema.schemaChecks, eq(schema.schemaCheckProposals.schemaCheckId, schema.schemaChecks.id))
      .where(whereCondition)
      .orderBy(desc(schema.schemaCheckProposals.createdAt))
      .limit(limit)
      .offset(offset);

    // Get the total count of checks for this proposal
    const checksCount = await this.db
      .select({
        schemaCheckId: schema.schemaCheckProposals.schemaCheckId,
      })
      .from(schema.schemaCheckProposals)
      .where(whereCondition);

    const schemaCheckRepo = new SchemaCheckRepository(this.db);
    // Get all checkedSubgraphs for all checks in one go
    const checksWithSubgraphs = await Promise.all(
      checksList.map(async (c) => {
        const checkedSubgraphs = await schemaCheckRepo.getCheckedSubgraphsForCheckIdAndFederatedGraphId({
          checkId: c.id,
          federatedGraphId,
        });

        return {
          id: c.id,
          timestamp: c.createdAt.toISOString(),
          isBreaking: c.hasBreakingChanges ?? false,
          isComposable: c.isComposable ?? false,
          isDeleted: c.isDeleted ?? false,
          hasClientTraffic: c.hasClientTraffic ?? false,
          isForcedSuccess: c.forcedSuccess ?? false,
          ghDetails: c.ghDetails
            ? {
                commitSha: c.ghDetails.commitSha,
                ownerSlug: c.ghDetails.ownerSlug,
                repositorySlug: c.ghDetails.repositorySlug,
                checkRunId: c.ghDetails.checkRunId,
              }
            : undefined,
          hasLintErrors: c.hasLintErrors ?? false,
          hasGraphPruningErrors: c.hasGraphPruningErrors ?? false,
          clientTrafficCheckSkipped: c.clientTrafficCheckSkipped ?? false,
          lintSkipped: c.lintSkipped ?? false,
          graphPruningSkipped: c.graphPruningSkipped ?? false,
          checkedSubgraphs,
          proposalMatch: c.proposalMatch || undefined,
        };
      }),
    );

    return {
      checks: checksWithSubgraphs,
      checksCount: checksCount.length,
    };
  }

  public async markProposalSubgraphAsPublished({
    proposalSubgraphId,
    proposalId,
  }: {
    proposalSubgraphId: string;
    proposalId: string;
  }) {
    await this.db
      .update(schema.proposalSubgraphs)
      .set({ isPublished: true })
      .where(
        and(eq(schema.proposalSubgraphs.id, proposalSubgraphId), eq(schema.proposalSubgraphs.proposalId, proposalId)),
      );

    const proposalSubgraphs = await this.db
      .select({
        id: schema.proposalSubgraphs.id,
        isPublished: schema.proposalSubgraphs.isPublished,
      })
      .from(schema.proposalSubgraphs)
      .where(eq(schema.proposalSubgraphs.proposalId, proposalId));

    // if all the proposalSubgraphs are published, update the proposal state to PUBLISHED
    const allPublished = proposalSubgraphs.every((subgraph) => subgraph.isPublished);
    if (allPublished) {
      await this.updateProposal({
        id: proposalId,
        state: 'PUBLISHED',
        proposalSubgraphs: [],
      });
    }
  }

  public async getProposalByCheckId({ checkId }: { checkId: string }) {
    const proposal = await this.db
      .select({
        proposalId: schema.proposals.id,
        proposalName: schema.proposals.name,
      })
      .from(schema.schemaCheckProposals)
      .innerJoin(schema.proposals, eq(schema.schemaCheckProposals.proposalId, schema.proposals.id))
      .where(eq(schema.schemaCheckProposals.schemaCheckId, checkId));

    if (proposal.length === 0) {
      return undefined;
    }

    return {
      proposalId: proposal[0].proposalId,
      proposalName: proposal[0].proposalName,
    };
  }

  public async getProposalSchemaMatchesOfCheck({
    checkId,
    federatedGraphId,
  }: {
    checkId: string;
    federatedGraphId: string;
  }) {
    const proposalMatches = await this.db
      .select({
        proposalId: schema.schemaCheckProposalMatch.proposalId,
        proposalName: schema.proposals.name,
        proposalMatch: schema.schemaCheckProposalMatch.proposalMatch,
      })
      .from(schema.schemaCheckProposalMatch)
      .innerJoin(schema.proposals, eq(schema.schemaCheckProposalMatch.proposalId, schema.proposals.id))
      .where(
        and(
          eq(schema.schemaCheckProposalMatch.schemaCheckId, checkId),
          eq(schema.proposals.federatedGraphId, federatedGraphId),
        ),
      );

    return proposalMatches;
  }
}
