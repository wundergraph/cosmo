import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { OrganizationGroupDTO } from '../../types/index.js';
import { OrganizationRole } from '../../db/models.js';

export class OrganizationGroupRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async create(input: {
    organizationId: string;
    name: string;
    description: string;
    kcGroupId: string;
  }): Promise<OrganizationGroupDTO> {
    const insertedRuleSet = await this.db
      .insert(schema.organizationGroups)
      .values({
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        kcGroupId: input.kcGroupId,
      })
      .returning()
      .execute();

    return {
      groupId: insertedRuleSet[0].id,
      name: input.name,
      description: input.description,
      kcGroupId: input.kcGroupId,
      kcMapperId: null,
      membersCount: 0,
      rules: [],
    };
  }

  public async nameExists(input: { organizationId: string; name?: string }) {
    if (!input.name) {
      return false;
    }

    const existingRuleSet = await this.db
      .select({ id: schema.organizationGroups.id })
      .from(schema.organizationGroups)
      .where(
        and(
          eq(schema.organizationGroups.organizationId, input.organizationId),
          eq(schema.organizationGroups.name, input.name!),
        ),
      )
      .limit(1)
      .execute();

    return existingRuleSet.length > 0;
  }

  public async byId(input: { organizationId: string; groupId: string }): Promise<OrganizationGroupDTO | undefined> {
    const orgGroup = await this.db.query.organizationGroups.findFirst({
      where: and(
        eq(schema.organizationGroups.organizationId, input.organizationId),
        eq(schema.organizationGroups.id, input.groupId),
      ),
      with: {
        rules: {
          columns: {
            role: true,
            resources: true,
          },
        },
      },
      extras: (table, { sql }) => ({
        // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
        // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
        membersCount: sql<number>`CAST((
          select count(distinct "organization_member_id")
          from "organization_group_members"
          where "organization_group_members"."group_id" = ${table.id}
        ) AS INTEGER)`.as('members_count'),
      }),
    });

    if (!orgGroup) {
      return undefined;
    }

    const { id, ...rest } = orgGroup;
    return {
      groupId: id,
      ...rest,
      description: orgGroup.description,
      rules: orgGroup.rules.map(({ role, resources }) => ({
        role,
        resources: resources?.split(','),
      })),
    };
  }

  public async forOrganization(organizationId: string): Promise<OrganizationGroupDTO[]> {
    const orgGroups = await this.db.query.organizationGroups.findMany({
      where: eq(schema.organizationGroups.organizationId, organizationId),
      with: {
        rules: {
          columns: {
            role: true,
            resources: true,
          },
        },
      },
      extras: (table, { sql }) => ({
        // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
        // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
        membersCount: sql<number>`CAST((
          select count(distinct "organization_member_id")
          from "organization_group_members"
          where "organization_group_members"."group_id" = ${table.id}
        ) AS INTEGER)`.as('members_count'),
      }),
    });

    return orgGroups.map(({ id, rules, ...rest }) => ({
      groupId: id,
      ...rest,
      rules: rules.map(({ role, resources }) => ({
        role,
        resources: resources?.split(','),
      })),
    }));
  }

  /**
   * Retrieves the email addresses for all the members that have been added to the group matching the
   * provided `groupId`
   */
  public getGroupMembers(groupId: string) {
    return this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.organizationGroupMembers)
      .rightJoin(
        schema.organizationsMembers,
        eq(schema.organizationsMembers.id, schema.organizationGroupMembers.organizationMemberId),
      )
      .rightJoin(schema.users, eq(schema.users.id, schema.organizationsMembers.userId))
      .where(eq(schema.organizationGroupMembers.groupId, groupId))
      .execute();
  }

  public changeMemberGroup({ fromGroupId, toGroupId }: { fromGroupId: string; toGroupId: string }) {
    return this.db
      .update(schema.organizationGroupMembers)
      .set({ groupId: toGroupId })
      .where(eq(schema.organizationGroupMembers.groupId, fromGroupId));
  }

  public addUserToGroup(input: { organizationMemberId: string; groupId: string }) {
    return this.db.insert(schema.organizationGroupMembers).values(input).execute();
  }

  public updateGroup(input: {
    groupId: string;
    description: string;
    rules: { role: OrganizationRole; resources: string[] }[];
  }) {
    return this.db.transaction(async (tx) => {
      await tx
        .update(schema.organizationGroups)
        .set({ description: input.description })
        .where(eq(schema.organizationGroups.id, input.groupId))
        .execute();

      await tx
        .delete(schema.organizationGroupRules)
        .where(eq(schema.organizationGroupRules.groupId, input.groupId))
        .execute();

      if (input.rules.length === 0) {
        return;
      }

      await tx.insert(schema.organizationGroupRules).values(
        input.rules.map(({ role, resources }) => ({
          groupId: input.groupId,
          role,
          resources: resources.length > 0 ? resources.filter(Boolean).join(',') : null,
        })),
      );
    });
  }

  public deleteById(id: string) {
    return this.db.delete(schema.organizationGroups).where(eq(schema.organizationGroups.id, id)).returning();
  }
}
