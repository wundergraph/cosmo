import { and, eq, inArray, SQL } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { alias } from "drizzle-orm/pg-core";
import * as schema from '../../db/schema.js';
import { OrganizationGroupDTO } from '../../types/index.js';
import { OrganizationRole } from '../../db/models.js';
import { organizationRoleEnum } from '../../db/schema.js';

export class OrganizationGroupRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public create(input: {
    organizationId: string;
    name: string;
    description: string;
    kcGroupId: string | null;
  }): Promise<OrganizationGroupDTO> {
    return this.db.transaction(async (tx) => {
      const insertedGroup = await tx
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
        groupId: insertedGroup[0].id,
        name: input.name,
        description: input.description,
        kcGroupId: input.kcGroupId,
        kcMapperId: null,
        membersCount: 0,
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
      with: {
        rules: {
          columns: {
            role: true,
            allowAnyNamespace: true,
            allowAnyResource: true,
          },
          with: {
            namespaces: {
              with: {
                namespace: {
                  columns: {
                    name: true,
                  },
                },
              },
            },
            targets: true,
          },
        },
      },
      extras: (table, { sql }) => ({
        // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
        // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
        membersCount: sql<number>`
          CAST((
            select count(distinct "organization_member_id")
            from "organization_group_members"
            where "organization_group_members"."group_id" = ${table.id}
          ) AS INTEGER)
          +
          CAST((select count("id") from "api_keys" where "api_keys"."group_id" = ${table.id}) AS INTEGER)
        `.as('members_count'),
      }),
    });

    return orgGroups.map(({ id, rules, ...rest }) => ({
      groupId: id,
      ...rest,
      rules: rules.map((rule) => ({
        role: rule.role,
        allowAnyNamespace: rule.allowAnyNamespace,
        namespaces: rule.namespaces.map((ns) => ns.namespace.name),
        allowAnyResource: rule.allowAnyResource,
        resources: rule.targets.map((targ) => targ.targetId),
      })),
    }));
  }

  public async importKeycloakGroups(input: { organizationId: string; kcGroups: { id: string; name: string }[] }) {
    for (const group of input.kcGroups) {
      const createdGroup = await this.create({
        organizationId: input.organizationId,
        name: group.name,
        description: '',
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
        })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.groupId, groupId)),
    ]);
  }

  public changeMemberGroup({ fromGroupId, toGroupId }: { fromGroupId: string; toGroupId: string }) {
    return this.db.transaction(async (tx) => {
      await tx
        .update(schema.organizationGroupMembers)
        .set({ groupId: toGroupId })
        .where(eq(schema.organizationGroupMembers.groupId, fromGroupId));

      await tx.update(schema.apiKeys).set({ groupId: toGroupId }).where(eq(schema.apiKeys.groupId, fromGroupId));
    });
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
      allowAnyNamespace?: boolean;
      namespaces: string[];
      allowAnyResource?: boolean;
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
          .values({
            groupId: input.groupId,
            role: rule.role,
            allowAnyNamespace: rule.allowAnyNamespace ?? false,
            allowAnyResource: rule.allowAnyResource ?? false,
          })
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
                inArray(schema.namespaces.name, rule.namespaces),
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
          await tx.insert(schema.organizationGroupRuleTargets).values(
            rule.resources.map((targ) => ({
              ruleId: insertedRule[0].id,
              targetId: targ,
            })),
          );
        }
      }
    });
  }

  public deleteById(id: string) {
    return this.db.delete(schema.organizationGroups).where(eq(schema.organizationGroups.id, id)).returning();
  }

  public async getHierarchicalGroupRules(input: { organizationId: string; groupId: string }) {
    const rules = await this.db
      .select({
        id: schema.organizationGroupRules.id,
        role: schema.organizationGroupRules.role,
        allowAnyNamespace: schema.organizationGroupRules.allowAnyNamespace,
        allowAnyResource: schema.organizationGroupRules.allowAnyResource,
      })
      .from(schema.organizationGroupRules)
      .where(eq(schema.organizationGroupRules.groupId, input.groupId))
      .execute();

    return await Promise.all(
      rules.map(async (rule) => {
        // First, retrieve all the namespaces this rule grant access to
        const namespaces = rule.allowAnyNamespace
          ? await this.db
              .select({ id: schema.namespaces.id })
              .from(schema.namespaces)
              .where(eq(schema.namespaces.organizationId, input.organizationId))
          : await this.db
              .select({ id: schema.organizationGroupRuleNamespaces.namespaceId })
              .from(schema.organizationGroupRuleNamespaces)
              .innerJoin(
                schema.namespaces,
                eq(schema.namespaces.id, schema.organizationGroupRuleNamespaces.namespaceId),
              )
              .where(eq(schema.organizationGroupRuleNamespaces.ruleId, rule.id));

        // Retrieve the targets
        const targets: { targetId: string }[] = [];
        if (rule.allowAnyResource || rule.allowAnyNamespace) {
          // All organization resources are allowed
          targets.push(
            ...(await this.db
              .select({ targetId: schema.targets.id })
              .from(schema.targets)
              .where(eq(schema.targets.organizationId, input.organizationId))),
          );
        } else if (namespaces.length > 0) {
          // Retrieve the targets only for the allowed namespaces
          targets.push(
            ...(await this.db
              .select({ targetId: schema.targets.id })
              .from(schema.targets)
              .where(
                and(
                  eq(schema.targets.type, 'federated'),
                  inArray(
                    schema.targets.namespaceId,
                    namespaces.map((ns) => ns.id),
                  ),
                ),
              )),
          );
        }

        // Retrieve the allowed resources
        if (!rule.allowAnyResource && !rule.allowAnyNamespace) {
          const ruleTargets = await this.db
            .select({
              targetId: schema.targets.id,
              targetType: schema.targets.type,
            })
            .from(schema.organizationGroupRuleTargets)
            .innerJoin(schema.targets, eq(schema.targets.id, schema.organizationGroupRuleTargets.targetId));

          const federatedGraphs = [...targets, ...ruleTargets.filter((targ) => targ.targetType === 'federated')]
            .map((targ) => targ.targetId);

          targets.push(
            ...ruleTargets.map((targ) => ({ targetId: targ.targetId })),
          );

          if (federatedGraphs.length > 0) {
            const sgTargetAlias = alias(schema.targets, 'sgTargetAlias');
            targets.push(
              ...(
                await this.db
                  .select({ targetId: sgTargetAlias.id, })
                  .from(sgTargetAlias)
                  .innerJoin(schema.targets, inArray(schema.targets.id, federatedGraphs))
                  .innerJoin(schema.federatedGraphs, eq(schema.federatedGraphs.targetId, schema.targets.id))
                  .innerJoin(
                    schema.subgraphsToFederatedGraph,
                    eq(schema.subgraphsToFederatedGraph.federatedGraphId, schema.federatedGraphs.id)
                  )
                  .innerJoin(
                    schema.subgraphs,
                    eq(schema.subgraphs.id, schema.subgraphsToFederatedGraph.subgraphId)
                  )
                  .where(eq(sgTargetAlias.id, schema.subgraphs.targetId))
              )
            );
          }
        }

        return {
          role: rule.role,
          namespaces: [...new Set(namespaces.map((ns) => ns.id))],
          resources: [...new Set(targets.map((targ) => targ.targetId))],
        };
      }),
    );
  }
}
