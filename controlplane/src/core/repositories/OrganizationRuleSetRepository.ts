import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { OrganizationRuleSetDTO } from '../../types/index.js';
import { MemberRole } from '../../db/models.js';

export class OrganizationRuleSetRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async createRuleSet(input: {
    organizationId: string;
    name: string;
    builtin?: boolean;
    kcGroupId: string;
  }): Promise<OrganizationRuleSetDTO> {
    const insertedRuleSet = await this.db
      .insert(schema.organizationRuleSets)
      .values({
        organizationId: input.organizationId,
        name: input.name,
        builtin: input.builtin ?? false,
        kcGroupId: input.kcGroupId,
      })
      .returning()
      .execute();

    return {
      id: insertedRuleSet[0].id,
      name: input.name,
      builtin: insertedRuleSet[0].builtin,
      kcGroupId: input.kcGroupId,
      membersCount: 0,
      rules: [],
    };
  }

  public async exists(input: { organizationId: string; ruleSetId?: string; ruleSetName?: string }) {
    if (!input.ruleSetId && !input.ruleSetName) {
      return false;
    }

    const existingRuleSet = await this.db
      .select({ id: schema.organizationRuleSets.id })
      .from(schema.organizationRuleSets)
      .where(
        and(
          eq(schema.organizationRuleSets.organizationId, input.organizationId),
          input.ruleSetId
            ? eq(schema.organizationRuleSets.id, input.ruleSetId)
            : eq(schema.organizationRuleSets.name, input.ruleSetName!),
        ),
      )
      .limit(1)
      .execute();

    return existingRuleSet.length > 0;
  }

  public async byId(id: string): Promise<OrganizationRuleSetDTO | undefined> {
    const ruleSet = await this.db.query.organizationRuleSets.findFirst({
      where: eq(schema.organizationRuleSets.id, id),
      with: {
        rules: {
          columns: {
            role: true,
            resource: true,
          },
        },
      },
      extras: (table, { sql }) => ({
        // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
        // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
        membersCount: sql<number>`CAST((
          select count(*) 
          from "organization_rule_set_members" 
          where "organization_rule_set_members"."rule_set_id" = ${table.id}
        ) AS INTEGER)`.as('members_count'),
      }),
    });

    if (!ruleSet) {
      return undefined;
    }

    const rulesGroupedByRole = Object.groupBy(ruleSet.rules, (r) => r.role);
    return {
      ...ruleSet,
      rules: Object.entries(rulesGroupedByRole).flatMap(([role, value]) => ({
        role,
        resources: value.map((obj) => obj.resource),
      })),
    };
  }

  public async listForOrganization(organizationId: string): Promise<OrganizationRuleSetDTO[]> {
    const ruleSets = await this.db.query.organizationRuleSets.findMany({
      where: eq(schema.organizationRuleSets.organizationId, organizationId),
      with: {
        rules: {
          columns: {
            role: true,
            resource: true,
          },
        },
      },
      extras: (table, { sql }) => ({
        // There is an active issue that prevents using `schema.organizationRuleSetMembers` instead of directly
        // using strings (https://github.com/drizzle-team/drizzle-orm/issues/3493)
        membersCount: sql<number>`CAST((
          select count(*) 
          from "organization_rule_set_members" 
          where "organization_rule_set_members"."rule_set_id" = ${table.id}
        ) AS INTEGER)`.as('members_count'),
      }),
    });

    return ruleSets.map(({ rules, ...rs }) => {
      const rulesGroupedByRole = Object.groupBy(rules, (r) => r.role);

      return {
        ...rs,
        rules: Object.entries(rulesGroupedByRole).flatMap(([role, value]) => ({
          role,
          resources: value.map((obj) => obj.resource),
        })),
      };
    });
  }

  public updateRules(input: { ruleSetId: string; rules: { role: MemberRole; resources: string[] }[] }) {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(schema.organizationRuleSetRules)
        .where(eq(schema.organizationRuleSetRules.ruleSetId, input.ruleSetId))
        .execute();

      if (input.rules.length === 0) {
        return;
      }

      await tx.insert(schema.organizationRuleSetRules).values(
        input.rules.flatMap(({ role, resources }) =>
          resources.map((res) => ({
            ruleSetId: input.ruleSetId,
            role,
            resource: res,
          })),
        ),
      );
    });
  }

  public deleteRuleSet(id: string) {
    return this.db.delete(schema.organizationRuleSets).where(eq(schema.organizationRuleSets.id, id)).returning();
  }
}
