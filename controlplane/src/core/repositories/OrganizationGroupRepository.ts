import { and, eq, inArray, SQL } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { OrganizationGroupDTO } from '../../types/index.js';
import { OrganizationRole } from '../../db/models.js';
import { organizationRoleEnum } from '../../db/schema.js';
import { defaultGroupDescription } from '../test-util.js';

export class OrganizationGroupRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public create(input: {
    organizationId: string;
    name: string;
    description: string;
    builtin?: boolean;
    kcGroupId: string | null;
  }): Promise<OrganizationGroupDTO> {
    return this.db.transaction(async (tx) => {
      const insertedGroup = await tx
        .insert(schema.organizationGroups)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          builtin: input.builtin ?? false,
          kcGroupId: input.kcGroupId,
        })
        .returning()
        .execute();

      return {
        groupId: insertedGroup[0].id,
        name: input.name,
        description: input.description,
        builtin: input.builtin ?? false,
        kcGroupId: input.kcGroupId,
        membersCount: 0,
        apiKeysCount: 0,
        rules: [],
      };
    });
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
    if (!input.groupId) {
      return undefined;
    }

    const orgGroups = await this.findMany(
      and(
        eq(schema.organizationGroups.organizationId, input.organizationId),
        eq(schema.organizationGroups.id, input.groupId),
      ),
    );

    if (orgGroups.length !== 1) {
      return;
    }

    return orgGroups[0];
  }

  public byIds(input: { organizationId: string; groupIds: string[] }): Promise<OrganizationGroupDTO[]> {
    if (input.groupIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.findMany(
      and(
        eq(schema.organizationGroups.organizationId, input.organizationId),
        inArray(schema.organizationGroups.id, input.groupIds),
      ),
    );
  }

  public async byName(input: { organizationId: string; name: string }): Promise<OrganizationGroupDTO | undefined> {
    const orgGroups = await this.findMany(
      and(
        eq(schema.organizationGroups.organizationId, input.organizationId),
        eq(schema.organizationGroups.name, input.name),
      ),
    );

    if (orgGroups.length !== 1) {
      return;
    }

    return orgGroups[0];
  }

  public forOrganization(organizationId: string): Promise<OrganizationGroupDTO[]> {
    return this.findMany(eq(schema.organizationGroups.organizationId, organizationId));
  }

  private async findMany(where: SQL<unknown> | undefined): Promise<OrganizationGroupDTO[]> {
    if (!where) {
      return [];
    }

    const orgGroups = await this.db.query.organizationGroups.findMany({
      where,
      orderBy: (table, { asc }) => [asc(table.name)],
      extras: (_, { sql }) => ({
        // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
        // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
        membersCount: sql<number>`
          CAST((
            SELECT COUNT(DISTINCT "ogm"."organization_member_id")
            FROM "organization_group_members" as "ogm"
            WHERE "ogm"."group_id" = "organizationGroups"."id"
          ) AS INTEGER)
        `.as('members_count'),
        apiKeysCount: sql<number>`
          CAST((
            SELECT COUNT("api_keys"."id") FROM "api_keys" WHERE "api_keys"."group_id" = "organizationGroups"."id"
          ) AS INTEGER)
        `.as('api_keys_count'),
      }),
    });

    return Promise.all(
      orgGroups.map(
        async ({ id, organizationId, ...rest }) =>
          ({
            groupId: id!,
            ...rest,
            rules: await this.getGroupRules({ groupId: id, organizationId }),
          }) satisfies OrganizationGroupDTO,
      ),
    );
  }

  public async importKeycloakGroups(input: { organizationId: string; kcGroups: { id: string; name: string }[] }) {
    for (const group of input.kcGroups) {
      if (await this.nameExists({ organizationId: input.organizationId, name: group.name })) {
        // The group already exists, no need to try to create
        continue;
      }

      const createdGroup = await this.create({
        organizationId: input.organizationId,
        name: group.name,
        description: defaultGroupDescription[group.name] ?? '',
        builtin: group.name === 'admin',
        kcGroupId: group.id,
      });

      const roleName = `organization-${group.name}` as OrganizationRole;
      if (organizationRoleEnum.enumValues.includes(roleName)) {
        await this.updateGroup({
          organizationId: input.organizationId,
          groupId: createdGroup.groupId,
          rules: [{ role: roleName, namespaces: [], resources: [] }],
        });
      }
    }
  }

  public getGroupMembers(groupId: string) {
    return Promise.all([
      this.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          createdAt: schema.organizationGroupMembers.createdAt,
        })
        .from(schema.organizationGroupMembers)
        .rightJoin(
          schema.organizationsMembers,
          eq(schema.organizationsMembers.id, schema.organizationGroupMembers.organizationMemberId),
        )
        .rightJoin(schema.users, eq(schema.users.id, schema.organizationsMembers.userId))
        .where(eq(schema.organizationGroupMembers.groupId, groupId)),
      this.db
        .select({
          id: schema.apiKeys.id,
          name: schema.apiKeys.name,
          createdAt: schema.apiKeys.createdAt,
        })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.groupId, groupId)),
    ]);
  }

  public async changeMemberGroup({ fromGroupId, toGroupId }: { fromGroupId: string; toGroupId: string }) {
    // Update all members tied to the group by first deleting them and then linking them to the new group
    const memberCondition = eq(schema.organizationGroupMembers.groupId, fromGroupId);
    const members = await this.db
      .select({
        organizationMemberId: schema.organizationGroupMembers.organizationMemberId,
      })
      .from(schema.organizationGroupMembers)
      .where(memberCondition);

    await this.db.delete(schema.organizationGroupMembers).where(memberCondition);
    if (members.length > 0) {
      await this.db
        .insert(schema.organizationGroupMembers)
        .values(
          members.map((m) => ({
            organizationMemberId: m.organizationMemberId,
            groupId: toGroupId,
          })),
        )
        .onConflictDoNothing();
    }

    // Update all API keys tied to the group
    await this.db.update(schema.apiKeys).set({ groupId: toGroupId }).where(eq(schema.apiKeys.groupId, fromGroupId));

    // Update all invited users
    await this.db
      .update(schema.organizationInvitationGroups)
      .set({ groupId: toGroupId })
      .where(eq(schema.organizationInvitationGroups.groupId, fromGroupId));
  }

  public addUserToGroup(input: { organizationMemberId: string; groupId: string }) {
    return this.db.insert(schema.organizationGroupMembers).values(input).execute();
  }

  public updateGroup(input: {
    organizationId: string;
    groupId: string;
    description?: string;
    rules: {
      role: OrganizationRole;
      namespaces: string[];
      resources: string[];
    }[];
  }) {
    return this.db.transaction(async (tx) => {
      if (input.description !== undefined) {
        await tx
          .update(schema.organizationGroups)
          .set({ description: input.description })
          .where(eq(schema.organizationGroups.id, input.groupId))
          .execute();
      }

      await tx
        .delete(schema.organizationGroupRules)
        .where(eq(schema.organizationGroupRules.groupId, input.groupId))
        .execute();

      if (input.rules.length === 0) {
        return;
      }

      for (const rule of input.rules) {
        const insertedRule = await tx
          .insert(schema.organizationGroupRules)
          .values({ groupId: input.groupId, role: rule.role })
          .returning()
          .execute();

        if (insertedRule.length === 0) {
          throw new Error('Failed to create group rule');
        }

        if (rule.namespaces.length > 0) {
          const namespaces = await tx
            .select({ id: schema.namespaces.id })
            .from(schema.namespaces)
            .where(
              and(
                eq(schema.namespaces.organizationId, input.organizationId),
                inArray(schema.namespaces.id, rule.namespaces),
              ),
            );

          await tx.insert(schema.organizationGroupRuleNamespaces).values(
            namespaces.map((ns) => ({
              ruleId: insertedRule[0].id,
              namespaceId: ns.id,
            })),
          );
        }

        if (rule.resources.length > 0) {
          const actualTargets = await this.db
            .select({ targetId: schema.targets.id })
            .from(schema.targets)
            .where(
              and(eq(schema.targets.organizationId, input.organizationId), inArray(schema.targets.id, rule.resources)),
            );

          await tx.insert(schema.organizationGroupRuleTargets).values(
            actualTargets.map((targ) => ({
              ruleId: insertedRule[0].id,
              targetId: targ.targetId,
            })),
          );
        }
      }
    });
  }

  public deleteById(id: string) {
    return this.db.delete(schema.organizationGroups).where(eq(schema.organizationGroups.id, id)).returning();
  }

  public async getGroupRules(input: { organizationId: string; groupId: string }) {
    const rules = await this.db
      .select({
        id: schema.organizationGroupRules.id,
        role: schema.organizationGroupRules.role,
      })
      .from(schema.organizationGroupRules)
      .where(eq(schema.organizationGroupRules.groupId, input.groupId))
      .execute();

    return await Promise.all(
      rules.map(async (rule) => {
        const namespaces = await this.db
          .select({ id: schema.organizationGroupRuleNamespaces.namespaceId })
          .from(schema.organizationGroupRuleNamespaces)
          .innerJoin(schema.namespaces, eq(schema.namespaces.id, schema.organizationGroupRuleNamespaces.namespaceId))
          .where(eq(schema.organizationGroupRuleNamespaces.ruleId, rule.id));

        const targets = await this.db
          .select({ targetId: schema.targets.id })
          .from(schema.organizationGroupRuleTargets)
          .innerJoin(schema.targets, eq(schema.targets.id, schema.organizationGroupRuleTargets.targetId))
          .where(eq(schema.organizationGroupRuleTargets.ruleId, rule.id));

        return {
          role: rule.role,
          namespaces: namespaces.map((ns) => ns.id),
          resources: targets.map((targ) => targ.targetId),
        };
      }),
    );
  }
}
