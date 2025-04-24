import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { OrganizationMemberGroupDTO } from '../../types/index.js';
import { MemberRole } from '../../db/models.js';

export class OrganizationMemberGroupRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async createRuleSet(input: {
    organizationId: string;
    name: string;
    kcGroupId: string;
  }): Promise<OrganizationMemberGroupDTO> {
    const insertedRuleSet = await this.db
      .insert(schema.organizationMemberGroups)
      .values({
        organizationId: input.organizationId,
        name: input.name,
        kcGroupId: input.kcGroupId,
      })
      .returning()
      .execute();

    return {
      id: insertedRuleSet[0].id,
      name: input.name,
      kcGroupId: input.kcGroupId,
      kcMapperId: null,
      membersCount: 0,
      rules: [],
    };
  }

  public async exists(input: { organizationId: string; ruleSetId?: string; ruleSetName?: string }) {
    if (!input.ruleSetId && !input.ruleSetName) {
      return false;
    }

    const existingRuleSet = await this.db
      .select({ id: schema.organizationMemberGroups.id })
      .from(schema.organizationMemberGroups)
      .where(
        and(
          eq(schema.organizationMemberGroups.organizationId, input.organizationId),
          input.ruleSetId
            ? eq(schema.organizationMemberGroups.id, input.ruleSetId)
            : eq(schema.organizationMemberGroups.name, input.ruleSetName!),
        ),
      )
      .limit(1)
      .execute();

    return existingRuleSet.length > 0;
  }

  public async byId(input: {
    organizationId: string;
    groupId: string;
  }): Promise<OrganizationMemberGroupDTO | undefined> {
    const memberGroup = await this.db.query.organizationMemberGroups.findFirst({
      where: and(
        eq(schema.organizationMemberGroups.organizationId, input.organizationId),
        eq(schema.organizationMemberGroups.id, input.groupId)
      ),
      with: {
        rules: {
          columns: {
            role: true,
            resource: true,
          },
        },
      },
      // extras: (table, { sql }) => ({
      //   // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
      //   // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
      //   membersCount: sql<number>`CAST((
      //     select count(distinct "user_id")
      //     from "organization_rule_set_members"
      //     where "organization_rule_set_members"."rule_set_id" = ${table.id}
      //   ) AS INTEGER)`.as('members_count'),
      // }),
    });

    if (!memberGroup) {
      return undefined;
    }

    const rulesGroupedByRole = Object.groupBy(memberGroup.rules, (r) => r.role);
    return {
      ...memberGroup,
      membersCount: 0,
      rules: Object.entries(rulesGroupedByRole).flatMap(([role, value]) => ({
        role,
        resources: value.map((obj) => obj.resource),
      })),
    };
  }

  public async listForOrganization(organizationId: string): Promise<OrganizationMemberGroupDTO[]> {
    const ruleSets = await this.db.query.organizationMemberGroups.findMany({
      where: eq(schema.organizationMemberGroups.organizationId, organizationId),
      with: {
        rules: {
          columns: {
            role: true,
            resource: true,
          },
        },
      },
      // extras: (table, { sql }) => ({
      //   // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
      //   // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
      //   membersCount: sql<number>`CAST((
      //     select count(distinct "user_id")
      //     from "organization_rule_set_members"
      //     where "organization_rule_set_members"."rule_set_id" = ${table.id}
      //   ) AS INTEGER)`.as('members_count'),
      // }),
    });

    return ruleSets.map(({ rules, ...rs }) => {
      const rulesGroupedByRole = Object.groupBy(rules, (r) => r.role);

      return {
        ...rs,
        membersCount: 0,
        rules: Object.entries(rulesGroupedByRole).flatMap(([role, value]) => ({
          role,
          resources: value.map((obj) => obj.resource),
        })),
      };
    });
  }

  public updateRules(input: { ruleSetId: string; rules: { role: MemberRole; resources: string[] }[] }) {
    // return this.db.transaction(async (tx) => {
    //   await tx
    //     .delete(schema.organizationMemberGroups)
    //     .where(eq(schema.organizationMemberGroups.groupId, input.ruleSetId))
    //     .execute();
    //
    //   if (input.rules.length === 0) {
    //     return;
    //   }
    //
    //   await tx.insert(schema.organizationMemberGroups).values(
    //     input.rules.flatMap(({ role, resources }) =>
    //       resources.map((res) => ({
    //         ruleSetId: input.ruleSetId,
    //         role,
    //         resource: res,
    //       })),
    //     ),
    //   );
    // });
  }

  public deleteRuleSet(id: string) {
    return this.db.delete(schema.organizationMemberGroups).where(eq(schema.organizationMemberGroups.id, id)).returning();
  }
}
