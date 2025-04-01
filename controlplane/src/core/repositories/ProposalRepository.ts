import { eq, and, desc, gte, lte, count, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ProposalState } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import { LintSeverityLevel, ProposalDTO, ProposalSubgraphDTO } from '../../types/index.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';

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
      for (const subgraph of proposalSubgraphs) {
        await this.db
          .insert(schema.proposalSubgraphs)
          .values({
            proposalId: id,
            subgraphId: subgraph.subgraphId,
            subgraphName: subgraph.subgraphName,
            schemaSDL: subgraph.schemaSDL || null,
            isDeleted: subgraph.isDeleted,
            isNew: subgraph.isNew,
          })
          .onConflictDoUpdate({
            target: [schema.proposalSubgraphs.proposalId, schema.proposalSubgraphs.subgraphName],
            set: {
              schemaSDL: subgraph.schemaSDL || null,
              isDeleted: subgraph.isDeleted,
              isNew: subgraph.isNew,
            },
          });
      }
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
        proposedSchemaSDL: schema.proposalSubgraphs.schemaSDL,
      })
      .from(schema.proposalSubgraphs)
      .innerJoin(schema.proposals, eq(schema.proposalSubgraphs.proposalId, schema.proposals.id))
      .where(and(eq(schema.proposalSubgraphs.subgraphId, subgraphId), eq(schema.proposals.state, 'APPROVED')));

    return proposalSubgraphs;
  }

  public async matchSchemaWithProposal({
    subgraphId,
    schema,
    routerCompatibilityVersion,
  }: {
    subgraphId: string;
    schema: string;
    routerCompatibilityVersion: string;
  }) {
    const proposalSubgraphs = await this.getApprovedProposalSubgraphsBySubgraphId({ subgraphId });

    for (const proposalSubgraph of proposalSubgraphs) {
      if (!proposalSubgraph.proposedSchemaSDL) {
        continue;
      }
      const proposedSchema = proposalSubgraph.proposedSchemaSDL;
      const schemaChanges = await getDiffBetweenGraphs(schema, proposedSchema, routerCompatibilityVersion);
      if (schemaChanges.kind === 'failure') {
        continue;
      }
      if (schemaChanges.changes.length === 0) {
        return true;
      }
    }
    return false;
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

  public async getChecksByProposalId(
    proposalId: string,
    limit: number,
    offset: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{ checks: any[]; totalCount: number; countBasedOnDateRange: number }> {
    // Build the where condition
    let whereCondition: any = eq(schema.schemaCheckProposals.proposalId, proposalId);

    if (startDate && endDate) {
      whereCondition = and(
        whereCondition,
        gte(schema.schemaCheckProposals.createdAt, startDate),
        lte(schema.schemaCheckProposals.createdAt, endDate),
      );
    }

    const checkIdsQuery = this.db
      .select({
        schemaCheckId: schema.schemaCheckProposals.schemaCheckId,
      })
      .from(schema.schemaCheckProposals)
      .where(whereCondition)
      .orderBy(desc(schema.schemaCheckProposals.createdAt));

    // Get the total count of checks for this proposal
    const totalCount = await this.db
      .select({
        count: count(),
      })
      .from(schema.schemaCheckProposals)
      .where(eq(schema.schemaCheckProposals.proposalId, proposalId));

    // Get count based on date range
    const countBasedOnDateRange = await this.db
      .select({
        count: count(),
      })
      .from(schema.schemaCheckProposals)
      .where(whereCondition);

    // Get the paginated check IDs
    const paginatedCheckIds = await checkIdsQuery.limit(limit).offset(offset);

    // If no checks found, return empty result
    if (paginatedCheckIds.length === 0) {
      return {
        checks: [],
        totalCount: totalCount[0]?.count || 0,
        countBasedOnDateRange: countBasedOnDateRange[0]?.count || 0,
      };
    }

    const checkIds = paginatedCheckIds.map((c) => c.schemaCheckId);

    // Get the details of these checks
    const checksData = await this.db
      .select({
        check: {
          id: schema.schemaChecks.id,
          targetId: schema.schemaChecks.targetId,
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
        },
        target: {
          name: schema.targets.name,
        },
      })
      .from(schema.schemaChecks)
      .leftJoin(schema.targets, eq(schema.schemaChecks.targetId, schema.targets.id))
      .where(inArray(schema.schemaChecks.id, checkIds));

    // Get checked subgraphs for each check
    const checksList = await Promise.all(
      checksData.map(async (check) => {
        const checkedSubgraphs = await this.db
          .select({
            id: schema.schemaCheckSubgraphs.id,
            subgraphName: schema.schemaCheckSubgraphs.subgraphName,
            subgraphId: schema.schemaCheckSubgraphs.subgraphId,
            isDeleted: schema.schemaCheckSubgraphs.isDeleted,
            isNew: schema.schemaCheckSubgraphs.isNew,
          })
          .from(schema.schemaCheckSubgraphs)
          .where(eq(schema.schemaCheckSubgraphs.schemaCheckId, check.check.id));

        return {
          id: check.check.id,
          targetID: check.check.targetId,
          subgraphName: check.target?.name,
          timestamp: check.check.createdAt.toISOString(),
          isComposable: check.check.isComposable,
          isBreaking: check.check.hasBreakingChanges,
          hasClientTraffic: check.check.hasClientTraffic,
          isForcedSuccess: check.check.forcedSuccess,
          hasLintErrors: check.check.hasLintErrors,
          hasGraphPruningErrors: check.check.hasGraphPruningErrors,
          clientTrafficCheckSkipped: check.check.clientTrafficCheckSkipped,
          lintSkipped: check.check.lintSkipped,
          graphPruningSkipped: check.check.graphPruningSkipped,
          checkedSubgraphs,
        };
      }),
    );

    return {
      checks: checksList,
      totalCount: totalCount[0]?.count || 0,
      countBasedOnDateRange: countBasedOnDateRange[0]?.count || 0,
    };
  }
}
