import { and, eq, inArray, SQL } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { GraphResourceKind } from '../../db/models.js';
import { GraphResourceOwnerDTO } from '../../types/index.js';
import { traced } from '../tracing.js';

type OwnerRow = {
  federatedGraphId: string;
  resourceKind: GraphResourceKind;
  resource: string;
  groupId: string | null;
  organizationMemberId: string | null;
};

function toOwnerDTO(row: OwnerRow): GraphResourceOwnerDTO {
  return {
    federatedGraphId: row.federatedGraphId,
    resourceKind: row.resourceKind,
    resource: row.resource,
    groupId: row.groupId ?? undefined,
    orgMemberId: row.organizationMemberId ?? undefined,
  };
}

@traced
export class GraphResourceOwnerRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  private async findOwners(where: SQL<unknown> | undefined): Promise<GraphResourceOwnerDTO[]> {
    const rows = await this.db
      .select({
        federatedGraphId: schema.graphResourceOwners.federatedGraphId,
        resourceKind: schema.graphResourceOwners.resourceKind,
        resource: schema.graphResourceOwners.resource,
        groupId: schema.graphResourceOwners.groupId,
        organizationMemberId: schema.graphResourceOwners.organizationMemberId,
      })
      .from(schema.graphResourceOwners)
      .innerJoin(schema.federatedGraphs, eq(schema.federatedGraphs.id, schema.graphResourceOwners.federatedGraphId))
      .innerJoin(schema.targets, eq(schema.targets.id, schema.federatedGraphs.targetId))
      .where(and(eq(schema.targets.organizationId, this.organizationId), where))
      .orderBy(schema.graphResourceOwners.resourceKind, schema.graphResourceOwners.resource);

    return rows.map((row) => toOwnerDTO(row));
  }

  public explicitOwnersForOrganization(): Promise<GraphResourceOwnerDTO[]> {
    return this.findOwners(undefined);
  }

  public explicitOwnersForGraph(federatedGraphId: string): Promise<GraphResourceOwnerDTO[]> {
    return this.findOwners(eq(schema.graphResourceOwners.federatedGraphId, federatedGraphId));
  }

  // One owner per (federated graph, subgraph, group) for every subgraph-admin rule that targets a subgraph.
  public async subgraphOwnersFromGroupRules(): Promise<GraphResourceOwnerDTO[]> {
    const rows = await this.db
      .selectDistinct({
        federatedGraphId: schema.subgraphsToFederatedGraph.federatedGraphId,
        resource: schema.targets.name,
        groupId: schema.organizationGroupRules.groupId,
      })
      .from(schema.organizationGroupRules)
      .innerJoin(
        schema.organizationGroupRuleTargets,
        eq(schema.organizationGroupRuleTargets.ruleId, schema.organizationGroupRules.id),
      )
      .innerJoin(schema.targets, eq(schema.targets.id, schema.organizationGroupRuleTargets.targetId))
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, schema.targets.id))
      .innerJoin(schema.subgraphsToFederatedGraph, eq(schema.subgraphsToFederatedGraph.subgraphId, schema.subgraphs.id))
      .where(
        and(
          eq(schema.organizationGroupRules.role, 'subgraph-admin'),
          eq(schema.targets.organizationId, this.organizationId),
        ),
      )
      .orderBy(schema.targets.name);

    return rows.map((row) => ({
      federatedGraphId: row.federatedGraphId,
      resourceKind: 'subgraph',
      resource: row.resource,
      groupId: row.groupId,
    }));
  }

  public async organizationMemberIdsInOrganization(orgMemberIds: string[]): Promise<string[]> {
    if (orgMemberIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({ id: schema.organizationsMembers.id })
      .from(schema.organizationsMembers)
      .where(
        and(
          eq(schema.organizationsMembers.organizationId, this.organizationId),
          inArray(schema.organizationsMembers.id, orgMemberIds),
        ),
      );

    return rows.map((row) => row.id);
  }

  public replaceOwners(input: {
    federatedGraphId: string;
    resourceKind: GraphResourceKind;
    resource: string;
    groupIds: string[];
    orgMemberIds: string[];
  }) {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(schema.graphResourceOwners)
        .where(
          and(
            eq(schema.graphResourceOwners.federatedGraphId, input.federatedGraphId),
            eq(schema.graphResourceOwners.resourceKind, input.resourceKind),
            eq(schema.graphResourceOwners.resource, input.resource),
          ),
        );

      const groupOwners = input.groupIds.map((groupId) => ({
        federatedGraphId: input.federatedGraphId,
        resourceKind: input.resourceKind,
        resource: input.resource,
        groupId,
      }));

      const memberOwners = input.orgMemberIds.map((organizationMemberId) => ({
        federatedGraphId: input.federatedGraphId,
        resourceKind: input.resourceKind,
        resource: input.resource,
        organizationMemberId,
      }));

      const owners = [...groupOwners, ...memberOwners];
      if (owners.length === 0) {
        return;
      }

      await tx.insert(schema.graphResourceOwners).values(owners);
    });
  }
}
