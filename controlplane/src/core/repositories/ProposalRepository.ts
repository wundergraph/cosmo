import { and, count, desc, eq, gt, lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { ProposalState } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import { GetChecksResponse, Label, LintSeverityLevel, ProposalDTO, ProposalSubgraphDTO } from '../../types/index.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';
import { isCheckSuccessful, normalizeLabels } from '../util.js';
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
      currentSchemaVersionId?: string;
      labels: Label[];
    }[];
  }): Promise<ProposalDTO> {
    const proposal = await this.db
      .insert(schema.proposals)
      .values({
        federatedGraphId,
        name,
        createdById: userId,
        state: 'DRAFT',
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
        currentSchemaVersionId: subgraph.currentSchemaVersionId,
        labels: subgraph.isNew ? normalizeLabels(subgraph.labels).map((l) => joinLabel(l)) : undefined,
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
        currentSchemaVersionId: schema.proposalSubgraphs.currentSchemaVersionId,
        isNew: schema.proposalSubgraphs.isNew,
        labels: schema.proposalSubgraphs.labels,
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
        currentSchemaVersionId: subgraph.currentSchemaVersionId || undefined,
        isNew: subgraph.isNew,
        labels: subgraph.labels ? subgraph.labels.map((l) => splitLabel(l)) : [],
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
        currentSchemaVersionId: schema.proposalSubgraphs.currentSchemaVersionId,
        isNew: schema.proposalSubgraphs.isNew,
        labels: schema.proposalSubgraphs.labels,
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
        currentSchemaVersionId: subgraph.currentSchemaVersionId || undefined,
        isNew: subgraph.isNew,
        labels: subgraph.labels ? subgraph.labels.map((l) => splitLabel(l)) : [],
      })),
    };
  }

  public async ByFederatedGraphId({
    federatedGraphId,
    startDate,
    endDate,
    limit,
    offset,
  }: {
    federatedGraphId: string;
    startDate?: string;
    endDate?: string;
    limit: number;
    offset: number;
  }): Promise<{ proposals: { proposal: ProposalDTO; proposalSubgraphs: ProposalSubgraphDTO[] }[] }> {
    let whereCondition: any = eq(schema.proposals.federatedGraphId, federatedGraphId);

    if (startDate && endDate) {
      whereCondition = and(
        whereCondition,
        gt(schema.proposals.createdAt, new Date(startDate)),
        lt(schema.proposals.createdAt, new Date(endDate)),
      );
    }

    const proposalsWithSubgraphs: { proposal: ProposalDTO; proposalSubgraphs: ProposalSubgraphDTO[] }[] = [];
    const proposalsQuery = this.db
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
      .where(whereCondition)
      .orderBy(desc(schema.proposals.createdAt));

    if (limit) {
      proposalsQuery.limit(limit);
    }

    if (offset) {
      proposalsQuery.offset(offset);
    }

    const proposals = await proposalsQuery;

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
          isNew: schema.proposalSubgraphs.isNew,
          labels: schema.proposalSubgraphs.labels,
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
          isNew: subgraph.isNew,
          labels: subgraph.labels ? subgraph.labels.map((l) => splitLabel(l)) : [],
        })),
      });
    }

    return {
      proposals: proposalsWithSubgraphs,
    };
  }

  public async countByFederatedGraphId({
    federatedGraphId,
    startDate,
    endDate,
  }: {
    federatedGraphId: string;
    startDate?: string;
    endDate?: string;
  }): Promise<number> {
    let whereCondition: any = eq(schema.proposals.federatedGraphId, federatedGraphId);

    if (startDate && endDate) {
      whereCondition = and(
        whereCondition,
        gt(schema.proposals.createdAt, new Date(startDate)),
        lt(schema.proposals.createdAt, new Date(endDate)),
      );
    }

    const result = await this.db
      .select({
        count: count(),
      })
      .from(schema.proposals)
      .where(whereCondition);

    return result[0]?.count || 0;
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
      currentSchemaVersionId?: string;
      labels: Label[];
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
          currentSchemaVersionId: subgraph.currentSchemaVersionId,
          labels: subgraph.isNew ? normalizeLabels(subgraph.labels).map((l) => joinLabel(l)) : undefined,
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

  public async getApprovedProposalSubgraphsBySubgraph({
    subgraphName,
    namespaceId,
  }: {
    subgraphName: string;
    namespaceId: string;
  }) {
    const proposalSubgraphs = await this.db
      .select({
        id: schema.proposalSubgraphs.id,
        proposalId: schema.proposalSubgraphs.proposalId,
        proposedSchemaSDL: schema.proposalSubgraphs.schemaSDL,
        isDeleted: schema.proposalSubgraphs.isDeleted,
        isNew: schema.proposalSubgraphs.isNew,
      })
      .from(schema.proposalSubgraphs)
      .innerJoin(schema.proposals, eq(schema.proposalSubgraphs.proposalId, schema.proposals.id))
      .innerJoin(schema.federatedGraphs, eq(schema.proposals.federatedGraphId, schema.federatedGraphs.id))
      .innerJoin(schema.targets, eq(schema.federatedGraphs.targetId, schema.targets.id))
      .where(
        and(
          eq(schema.proposalSubgraphs.subgraphName, subgraphName),
          eq(schema.proposals.state, 'APPROVED'),
          eq(schema.targets.namespaceId, namespaceId),
        ),
      );

    return proposalSubgraphs;
  }

  public async matchSchemaWithProposal({
    subgraphName,
    namespaceId,
    schemaCheckId,
    schemaSDL,
    routerCompatibilityVersion,
    isDeleted,
  }: {
    subgraphName: string;
    namespaceId: string;
    schemaCheckId?: string;
    schemaSDL: string;
    routerCompatibilityVersion: string;
    isDeleted: boolean;
  }): Promise<{ proposalId: string; proposalSubgraphId: string } | undefined> {
    const proposalSubgraphs = await this.getApprovedProposalSubgraphsBySubgraph({
      subgraphName,
      namespaceId,
    });

    for (const proposalSubgraph of proposalSubgraphs) {
      if (proposalSubgraph.isDeleted && isDeleted) {
        if (schemaCheckId) {
          await this.db
            .insert(schema.schemaCheckProposalMatch)
            .values({
              proposalId: proposalSubgraph.proposalId,
              proposalMatch: true,
              schemaCheckId,
            })
            .onConflictDoUpdate({
              target: [schema.schemaCheckProposalMatch.schemaCheckId, schema.schemaCheckProposalMatch.proposalId],
              set: {
                proposalMatch: true,
              },
            });
        }
        return {
          proposalId: proposalSubgraph.proposalId,
          proposalSubgraphId: proposalSubgraph.id,
        };
      }

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
    organizationId: string,
  ): Promise<{ checkId: string; isSuccessful: boolean } | null> {
    const latestCheck = await this.db
      .select({
        schemaCheckId: schema.proposalChecks.schemaCheckId,
      })
      .from(schema.proposalChecks)
      .where(eq(schema.proposalChecks.proposalId, proposalId))
      .orderBy(desc(schema.proposalChecks.createdAt))
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

    const schemaCheckRepo = new SchemaCheckRepository(this.db);
    const linkedChecks = await schemaCheckRepo.getLinkedSchemaChecks({
      schemaCheckID: check[0].id,
      organizationId,
    });
    const isLinkedTrafficCheckFailed = linkedChecks.some(
      (linkedCheck) => linkedCheck.hasClientTraffic && !linkedCheck.isForcedSuccess,
    );
    const isLinkedPruningCheckFailed = linkedChecks.some(
      (linkedCheck) => linkedCheck.hasGraphPruningErrors && !linkedCheck.isForcedSuccess,
    );

    const isSuccessful = isCheckSuccessful({
      isComposable,
      isBreaking,
      hasClientTraffic,
      hasLintErrors,
      hasGraphPruningErrors,
      clientTrafficCheckSkipped,
      hasProposalMatchError: false,
      isLinkedTrafficCheckFailed,
      isLinkedPruningCheckFailed,
    });

    return {
      checkId: check[0].id,
      isSuccessful,
    };
  }

  public async getChecksByProposalId({
    proposalId,
    federatedGraphId,
    organizationId,
    limit,
    offset,
    startDate,
    endDate,
  }: {
    proposalId: string;
    federatedGraphId: string;
    organizationId: string;
    limit: number;
    offset: number;
    startDate?: string;
    endDate?: string;
  }): Promise<GetChecksResponse> {
    let whereCondition: any = eq(schema.proposalChecks.proposalId, proposalId);

    if (startDate && endDate) {
      whereCondition = and(
        whereCondition,
        gt(schema.proposalChecks.createdAt, new Date(startDate)),
        lt(schema.proposalChecks.createdAt, new Date(endDate)),
      );
    }

    const checksListQuery = this.db
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
        compositionSkipped: schema.schemaChecks.compositionSkipped,
        breakingChangesSkipped: schema.schemaChecks.breakingChangesSkipped,
        errorMessage: schema.schemaChecks.errorMessage,
      })
      .from(schema.proposalChecks)
      .innerJoin(schema.schemaChecks, eq(schema.proposalChecks.schemaCheckId, schema.schemaChecks.id))
      .where(whereCondition)
      .orderBy(desc(schema.proposalChecks.createdAt));

    if (limit) {
      checksListQuery.limit(limit);
    }

    if (offset) {
      checksListQuery.offset(offset);
    }

    const checksList = await checksListQuery;

    // Get the total count of checks for this proposal
    const checksCount = await this.db
      .select({
        schemaCheckId: schema.proposalChecks.schemaCheckId,
      })
      .from(schema.proposalChecks)
      .where(whereCondition);

    const schemaCheckRepo = new SchemaCheckRepository(this.db);
    // Get all checkedSubgraphs for all checks in one go
    const checksWithSubgraphs = await Promise.all(
      checksList.map(async (c) => {
        const checkedSubgraphs = await schemaCheckRepo.getCheckedSubgraphsForCheckIdAndFederatedGraphId({
          checkId: c.id,
          federatedGraphId,
        });

        const linkedChecks = await schemaCheckRepo.getLinkedSchemaChecks({
          schemaCheckID: c.id,
          organizationId,
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
          compositionSkipped: c.compositionSkipped ?? false,
          breakingChangesSkipped: c.breakingChangesSkipped ?? false,
          errorMessage: c.errorMessage || undefined,
          linkedChecks,
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

    return {
      allSubgraphsPublished: allPublished,
    };
  }

  public async getProposalByCheckId({ checkId }: { checkId: string }) {
    const proposal = await this.db
      .select({
        proposalId: schema.proposals.id,
        proposalName: schema.proposals.name,
      })
      .from(schema.proposalChecks)
      .innerJoin(schema.proposals, eq(schema.proposalChecks.proposalId, schema.proposals.id))
      .where(eq(schema.proposalChecks.schemaCheckId, checkId));

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
