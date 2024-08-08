import { PartialMessage, PlainMessage } from '@bufbuild/protobuf';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  Integration,
  IntegrationConfig,
  IntegrationType,
  WebhookDelivery,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { addDays } from 'date-fns';
import { SQL, and, asc, count, desc, eq, gt, inArray, like, lt, not, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { MemberRole, NewOrganizationFeature } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import {
  billingSubscriptions,
  integrationTypeEnum,
  organizationBilling,
  organizationFeatures,
  organizationIntegrations,
  organizationMemberRoles,
  organizationWebhooks,
  organizations,
  organizationsMembers,
  slackIntegrationConfigs,
  slackSchemaUpdateEventConfigs,
  users,
} from '../../db/schema.js';
import { Feature, FeatureIds, OrganizationDTO, OrganizationMemberDTO, WebhooksConfigDTO } from '../../types/index.js';
import Keycloak from '../services/Keycloak.js';
import { DeleteOrganizationQueue } from '../workers/DeleteOrganizationWorker.js';
import { BillingRepository } from './BillingRepository.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';
import { OidcRepository } from './OidcRepository.js';

/**
 * Repository for organization related operations.
 */
export class OrganizationRepository {
  protected billing: BillingRepository;

  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private defaultBillingPlanId?: string,
  ) {
    this.billing = new BillingRepository(db);
  }

  public async createOrganization(input: {
    organizationID?: string;
    organizationName: string;
    organizationSlug: string;
    ownerID: string;
  }): Promise<OrganizationDTO> {
    const insertedOrg = await this.db
      .insert(organizations)
      .values({
        id: input.organizationID,
        name: input.organizationName,
        slug: input.organizationSlug,
        createdBy: input.ownerID,
      })
      .returning()
      .execute();

    const org: OrganizationDTO = {
      id: insertedOrg[0].id,
      name: insertedOrg[0].name,
      slug: insertedOrg[0].slug,
      creatorUserId: insertedOrg[0].createdBy || undefined,
      createdAt: insertedOrg[0].createdAt.toISOString(),
    };

    if (this.defaultBillingPlanId) {
      org.billing = {
        plan: this.defaultBillingPlanId,
      };
    }

    return org;
  }

  public async updateOrganization(input: { id: string; slug?: string; name?: string }) {
    await this.db
      .update(organizations)
      .set({
        name: input.name,
        slug: input.slug,
      })
      .where(eq(organizations.id, input.id))
      .execute();
  }

  public async bySlug(slug: string): Promise<OrganizationDTO | null> {
    const org = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
        billing: {
          plan: organizationBilling.plan,
        },
        subscription: {
          status: billingSubscriptions.status,
        },
        isDeactivated: organizations.isDeactivated,
        deactivationReason: organizations.deactivationReason,
        deactivatedAt: organizations.deactivatedAt,
      })
      .from(organizations)
      .leftJoin(organizationBilling, eq(organizations.id, organizationBilling.organizationId))
      .leftJoin(billingSubscriptions, eq(organizations.id, billingSubscriptions.organizationId))
      .where(eq(organizations.slug, slug))
      .limit(1)
      .execute();

    if (org.length === 0) {
      return null;
    }

    const plan = org[0].billing?.plan || this.defaultBillingPlanId;

    return {
      id: org[0].id,
      name: org[0].name,
      slug: org[0].slug,
      creatorUserId: org[0].creatorUserId || undefined,
      createdAt: org[0].createdAt.toISOString(),
      billing: plan
        ? {
            plan,
          }
        : undefined,
      subscription: org[0].subscription
        ? {
            status: org[0].subscription.status,
          }
        : undefined,
      deactivation: org[0].isDeactivated
        ? {
            reason: org[0].deactivationReason || undefined,
            initiatedAt: org[0].deactivatedAt?.toISOString() ?? '',
          }
        : undefined,
    };
  }

  public async byId(id: string): Promise<OrganizationDTO | null> {
    const org = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
        billing: {
          plan: organizationBilling.plan,
        },
        subscription: {
          status: billingSubscriptions.status,
        },
        isDeactivated: organizations.isDeactivated,
        deactivationReason: organizations.deactivationReason,
        deactivatedAt: organizations.deactivatedAt,
      })
      .from(organizations)
      .leftJoin(organizationBilling, eq(organizations.id, organizationBilling.organizationId))
      .leftJoin(billingSubscriptions, eq(organizations.id, billingSubscriptions.organizationId))
      .where(eq(organizations.id, id))
      .limit(1)
      .execute();

    if (org.length === 0) {
      return null;
    }

    const plan = org[0].billing?.plan || this.defaultBillingPlanId;

    return {
      id: org[0].id,
      name: org[0].name,
      slug: org[0].slug,
      creatorUserId: org[0].creatorUserId || undefined,
      createdAt: org[0].createdAt.toISOString(),
      billing: plan
        ? {
            plan,
          }
        : undefined,
      subscription: org[0].subscription
        ? {
            status: org[0].subscription.status,
          }
        : undefined,
      deactivation: org[0].isDeactivated
        ? {
            reason: org[0].deactivationReason || undefined,
            initiatedAt: org[0].deactivatedAt?.toISOString() ?? '',
          }
        : undefined,
    };
  }

  public async isMemberOf(input: { organizationId: string; userId: string }): Promise<boolean> {
    const userOrganizations = await this.db
      .select({
        userId: users.id,
        organizationId: organizations.id,
        slug: organizations.slug,
      })
      .from(organizationsMembers)
      .innerJoin(organizations, eq(organizations.id, input.organizationId))
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .limit(1)
      .where(eq(users.id, input.userId))
      .execute();

    return userOrganizations.length > 0;
  }

  public async memberships(input: { userId: string }): Promise<(OrganizationDTO & { roles: string[] })[]> {
    const userOrganizations = await this.db
      .selectDistinctOn([organizations.id], {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
        billing: {
          plan: organizationBilling.plan,
        },
        subscription: {
          status: billingSubscriptions.status,
          trialEnd: billingSubscriptions.trialEnd,
          cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd,
          currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
        },
        isDeactivated: organizations.isDeactivated,
        deactivationReason: organizations.deactivationReason,
        deactivatedAt: organizations.deactivatedAt,
      })
      .from(organizationsMembers)
      .innerJoin(organizations, eq(organizations.id, organizationsMembers.organizationId))
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .leftJoin(organizationBilling, eq(organizations.id, organizationBilling.organizationId))
      .leftJoin(billingSubscriptions, eq(organizations.id, billingSubscriptions.organizationId))
      .where(eq(users.id, input.userId))
      .execute();

    return Promise.all(
      userOrganizations.map(async (org) => {
        const plan = org.billing?.plan || this.defaultBillingPlanId;
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          creatorUserId: org.creatorUserId || undefined,
          createdAt: org.createdAt.toISOString(),
          roles: await this.getOrganizationMemberRoles({
            userID: input.userId,
            organizationID: org.id,
          }),
          features: await this.getFeatures({ organizationId: org.id, plan }),
          billing: plan
            ? {
                plan,
              }
            : undefined,
          subscription: org.subscription
            ? {
                status: org.subscription.status,
                trialEnd: org.subscription.trialEnd?.toISOString(),
                cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
                currentPeriodEnd: org.subscription.currentPeriodEnd?.toISOString(),
              }
            : undefined,
          deactivation: org.isDeactivated
            ? {
                reason: org.deactivationReason || undefined,
                initiatedAt: org.deactivatedAt?.toISOString() ?? '',
              }
            : undefined,
        };
      }),
    );
  }

  public async memberCount(organizationId: string, search?: string): Promise<number> {
    const count = await this.db
      .select({
        count: sql<number>`cast(count(${organizationsMembers.id}) as int)`,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(
        and(
          eq(organizationsMembers.organizationId, organizationId),
          search ? like(users.email, `%${search}%`) : undefined,
        ),
      )
      .groupBy(organizationsMembers.organizationId)
      .execute();

    return count[0]?.count || 0;
  }

  public async getOrganizationMember(input: {
    organizationID: string;
    userID: string;
  }): Promise<OrganizationMemberDTO | null> {
    const orgMember = await this.db
      .select({
        userID: users.id,
        email: users.email,
        memberID: organizationsMembers.id,
        active: users.active,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(and(eq(organizationsMembers.organizationId, input.organizationID), eq(users.id, input.userID)))
      .orderBy(asc(organizationsMembers.createdAt))
      .execute();

    if (orgMember.length === 0) {
      return null;
    }

    const userRoles = await this.getOrganizationMemberRoles({
      organizationID: input.organizationID,
      userID: input.userID,
    });

    return {
      userID: orgMember[0].userID,
      orgMemberID: orgMember[0].memberID,
      email: orgMember[0].email,
      roles: userRoles,
      active: orgMember[0].active,
    };
  }

  public async getOrganizationMemberByEmail(input: {
    organizationID: string;
    userEmail: string;
  }): Promise<OrganizationMemberDTO | null> {
    const orgMember = await this.db
      .select({
        userID: users.id,
        email: users.email,
        memberID: organizationsMembers.id,
        active: users.active,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(
        and(
          eq(organizationsMembers.organizationId, input.organizationID),
          eq(users.email, input.userEmail.toLowerCase()),
        ),
      )
      .orderBy(asc(organizationsMembers.createdAt))
      .execute();

    if (orgMember.length === 0) {
      return null;
    }

    const userRoles = await this.getOrganizationMemberRoles({
      organizationID: input.organizationID,
      userID: orgMember[0].userID,
    });

    return {
      userID: orgMember[0].userID,
      orgMemberID: orgMember[0].memberID,
      email: orgMember[0].email,
      roles: userRoles,
      active: orgMember[0].active,
    };
  }

  public async getMembers({
    organizationID,
    offset = 0,
    limit = 999,
    search,
  }: {
    organizationID: string;
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<OrganizationMemberDTO[]> {
    const conditions: SQL<unknown>[] = [eq(organizationsMembers.organizationId, organizationID)];

    if (search) {
      conditions.push(like(users.email, `%${search}%`));
    }

    const orgMembers = await this.db
      .select({
        userID: users.id,
        email: users.email,
        memberID: organizationsMembers.id,
        active: users.active,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(and(...conditions))
      .orderBy(asc(organizationsMembers.createdAt))
      .offset(offset)
      .limit(limit)
      .execute();

    const members: OrganizationMemberDTO[] = [];

    for (const member of orgMembers) {
      const roles = await this.db
        .select({
          role: organizationMemberRoles.role,
        })
        .from(organizationMemberRoles)
        .where(eq(organizationMemberRoles.organizationMemberId, member.memberID))
        .execute();
      members.push({
        userID: member.userID,
        orgMemberID: member.memberID,
        email: member.email,
        roles: roles.map((role) => role.role),
        active: member.active,
      } as OrganizationMemberDTO);
    }
    return members;
  }

  public async addOrganizationMember(input: { userID: string; organizationID: string }) {
    const insertedMember = await this.db
      .insert(organizationsMembers)
      .values({
        userId: input.userID,
        organizationId: input.organizationID,
      })
      .returning()
      .execute();
    return insertedMember[0];
  }

  public async addOrganizationMemberRoles(input: { memberID: string; roles: MemberRole[] }) {
    const values: {
      organizationMemberId: string;
      role: MemberRole;
    }[] = [];

    for (const role of input.roles) {
      values.push({
        organizationMemberId: input.memberID,
        role,
      });
    }

    await this.db.insert(organizationMemberRoles).values(values).execute();
  }

  public async removeOrganizationMember(input: { userID: string; organizationID: string }) {
    await this.db
      .delete(organizationsMembers)
      .where(
        and(
          eq(organizationsMembers.organizationId, input.organizationID),
          eq(organizationsMembers.userId, input.userID),
        ),
      )
      .execute();
  }

  public async getOrganizationMemberRoles(input: { userID: string; organizationID: string }): Promise<MemberRole[]> {
    const userRoles = await this.db
      .select({
        role: organizationMemberRoles.role,
      })
      .from(organizationMemberRoles)
      .innerJoin(organizationsMembers, eq(organizationsMembers.id, organizationMemberRoles.organizationMemberId))
      .where(
        and(
          eq(organizationsMembers.userId, input.userID),
          eq(organizationsMembers.organizationId, input.organizationID),
        ),
      )
      .execute();

    return userRoles.map((role) => role.role);
  }

  /**
   * Get the features for an organization. A feature can be enabled or disabled and can have a limit.
   * Usually, a feature without a limit is just a boolean flag.
   */
  public async getFeatures(input: { organizationId: string; plan?: string }): Promise<Feature[]> {
    let plan = input.plan;
    if (!input.plan) {
      const billing = await this.db.query.organizationBilling.findFirst({
        where: eq(organizationBilling.organizationId, input.organizationId),
        columns: {
          plan: true,
        },
      });

      // if no plan is set, we use the default plan
      plan = billing?.plan || this.defaultBillingPlanId;
    }

    const orgFeatures = await this.db
      .select({
        id: organizationFeatures.feature,
        enabled: organizationFeatures.enabled,
        limit: organizationFeatures.limit,
      })
      .from(organizationFeatures)
      .where(eq(organizationFeatures.organizationId, input.organizationId))
      .execute();

    const featureMap = new Map<string, Feature>();

    // Fill the map with the features from the organization
    for (const feature of orgFeatures) {
      featureMap.set(feature.id, {
        enabled: feature.enabled,
        id: feature.id as FeatureIds,
        limit: feature.limit,
      });
    }

    // Merge the features from the plan with the overrides from the organization
    if (plan) {
      const billingPlan = await this.billing.getPlanById(plan);
      const planFeatures = billingPlan?.features || [];
      for (const planFeature of planFeatures) {
        const feature = orgFeatures.find((f) => f.id === planFeature.id);
        if (feature) {
          featureMap.set(planFeature.id, {
            enabled: feature.enabled,
            id: feature.id as FeatureIds,
            limit: feature.limit,
          });
        } else {
          featureMap.set(planFeature.id, {
            enabled: true,
            id: planFeature.id as FeatureIds,
            limit: planFeature.limit,
          });
        }
      }
    }

    return [...featureMap.values()];
  }

  public async getFeature(input: { organizationId: string; featureId: FeatureIds }): Promise<Feature | undefined> {
    const billing = await this.db.query.organizationBilling.findFirst({
      where: eq(organizationBilling.organizationId, input.organizationId),
      columns: {
        plan: true,
      },
    });

    const plan = billing?.plan || this.defaultBillingPlanId;

    const feature = await this.db.query.organizationFeatures.findFirst({
      where: and(
        eq(organizationFeatures.organizationId, input.organizationId),
        eq(organizationFeatures.feature, input.featureId),
      ),
    });

    if (feature) {
      return {
        id: feature.feature as FeatureIds,
        enabled: feature.enabled,
        limit: feature.limit,
      };
    }

    // If the feature is not set for the organization, we try to find it in the plan
    if (plan) {
      const billingPlan = await this.billing.getPlanById(plan);
      const billingFeature = billingPlan?.features?.find((f) => f.id === input.featureId);
      if (!billingFeature) {
        return;
      }
      return {
        id: billingFeature.id,
        limit: billingFeature?.limit,
        enabled: true,
      };
    }
  }

  public async updateFeature(
    input: {
      organizationId: string;
    } & Feature,
  ) {
    const feature: NewOrganizationFeature = {
      feature: input.id,
      organizationId: input.organizationId,
    };

    if (input.enabled !== undefined) {
      feature.enabled = input.enabled;
    }

    if (input.limit !== undefined) {
      feature.limit = input.limit;
    }

    await this.db
      .insert(organizationFeatures)
      .values(feature)
      .onConflictDoUpdate({
        target: [organizationFeatures.organizationId, organizationFeatures.feature],
        set: feature,
      });
  }

  public async isFeatureEnabled(id: string, featureId: FeatureIds) {
    const feature = await this.db.query.organizationFeatures.findFirst({
      where: and(eq(organizationFeatures.organizationId, id), eq(organizationFeatures.feature, featureId)),
    });
    return !!feature?.enabled;
  }

  public async createWebhookConfig(input: {
    organizationId: string;
    endpoint: string;
    key: string;
    events: string[];
    eventsMeta: EventMeta[];
  }): Promise<string> {
    return await this.db.transaction(async (tx) => {
      const createWebhookResult = await tx
        .insert(organizationWebhooks)
        .values({
          organizationId: input.organizationId,
          endpoint: input.endpoint,
          events: input.events,
          key: input.key,
        })
        .returning();

      if (createWebhookResult.length === 0) {
        throw new Error('Failed to create webhook');
      }

      for (const eventMeta of input.eventsMeta) {
        switch (eventMeta.meta.case) {
          case 'federatedGraphSchemaUpdated':
          case 'monographSchemaUpdated': {
            const ids = eventMeta.meta.value.graphIds;
            if (ids.length === 0) {
              break;
            }
            await tx.insert(schema.webhookGraphSchemaUpdate).values(
              ids.map((id) => ({
                webhookId: createWebhookResult[0].id,
                federatedGraphId: id,
              })),
            );
            break;
          }
        }
      }

      return createWebhookResult[0].id;
    });
  }

  public async getWebhookMeta(id: string, organizationId: string): Promise<PlainMessage<EventMeta>[]> {
    const results = await this.db
      .select({
        graphId: schema.webhookGraphSchemaUpdate.federatedGraphId,
      })
      .from(schema.webhookGraphSchemaUpdate)
      .innerJoin(
        schema.organizationWebhooks,
        eq(schema.organizationWebhooks.id, schema.webhookGraphSchemaUpdate.webhookId),
      )
      .where(
        and(
          eq(schema.organizationWebhooks.organizationId, organizationId),
          eq(schema.webhookGraphSchemaUpdate.webhookId, id),
        ),
      );

    const meta: PartialMessage<EventMeta>[] = [];

    const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
    const federatedGraphIds = [];
    const monographIds = [];

    for (const graphId of results.map((r) => r.graphId)) {
      const graph = await fedGraphRepo.byId(graphId);

      if (!graph) {
        continue;
      }

      if (graph.supportsFederation) {
        federatedGraphIds.push(graph.id);
      } else {
        monographIds.push(graph.id);
      }
    }

    meta.push({
      eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
      meta: {
        case: 'federatedGraphSchemaUpdated',
        value: {
          graphIds: federatedGraphIds,
        },
      },
    });

    meta.push({
      eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
      meta: {
        case: 'monographSchemaUpdated',
        value: {
          graphIds: monographIds,
        },
      },
    });

    return meta as PlainMessage<EventMeta>[];
  }

  public async getWebhookConfigById(id: string, organizationId: string): Promise<WebhooksConfigDTO | null> {
    const res = await this.db.query.organizationWebhooks.findFirst({
      where: and(eq(organizationWebhooks.id, id), eq(organizationWebhooks.organizationId, organizationId)),
    });

    if (!res) {
      return null;
    }

    return {
      id: res.id,
      endpoint: res.endpoint ?? '',
      events: res.events ?? [],
    };
  }

  public async getWebhookConfigs(organizationId: string): Promise<WebhooksConfigDTO[]> {
    const res = await this.db.query.organizationWebhooks.findMany({
      where: eq(organizationWebhooks.organizationId, organizationId),
      orderBy: (webhooks, { desc }) => [desc(webhooks.createdAt)],
    });

    return res.map((r) => ({
      id: r.id,
      endpoint: r.endpoint ?? '',
      events: r.events ?? [],
    }));
  }

  public async updateWebhookConfig(input: {
    id: string;
    organizationId: string;
    endpoint: string;
    key: string;
    events: string[];
    eventsMeta: EventMeta[];
    shouldUpdateKey: boolean;
  }) {
    await this.db.transaction(async (tx) => {
      const set: Partial<typeof organizationWebhooks.$inferInsert> = {
        endpoint: input.endpoint,
        events: input.events,
      };
      if (input.shouldUpdateKey) {
        set.key = input.key;
      }

      await tx
        .update(organizationWebhooks)
        .set(set)
        .where(
          and(eq(organizationWebhooks.id, input.id), eq(organizationWebhooks.organizationId, input.organizationId)),
        );

      const graphIds: string[] = [];
      for (const eventMeta of input.eventsMeta) {
        switch (eventMeta.meta.case) {
          case 'federatedGraphSchemaUpdated':
          case 'monographSchemaUpdated': {
            graphIds.push(...eventMeta.meta.value.graphIds);
          }
        }
      }

      await tx
        .delete(schema.webhookGraphSchemaUpdate)
        .where(
          and(
            eq(schema.webhookGraphSchemaUpdate.webhookId, input.id),
            graphIds.length > 0 ? not(inArray(schema.webhookGraphSchemaUpdate.federatedGraphId, graphIds)) : undefined,
          ),
        );

      for (const eventMeta of input.eventsMeta) {
        switch (eventMeta.meta.case) {
          case 'federatedGraphSchemaUpdated':
          case 'monographSchemaUpdated': {
            const ids = eventMeta.meta.value.graphIds;
            if (ids.length === 0) {
              continue;
            }

            await tx
              .insert(schema.webhookGraphSchemaUpdate)
              .values(
                ids.map((id) => ({
                  webhookId: input.id,
                  federatedGraphId: id,
                })),
              )
              .onConflictDoNothing()
              .execute();
            break;
          }
        }
      }
    });
  }

  public async deleteWebhookConfig(input: { id: string; organizationId: string }) {
    const result = await this.db
      .delete(organizationWebhooks)
      .where(and(eq(organizationWebhooks.id, input.id), eq(organizationWebhooks.organizationId, input.organizationId)))
      .returning()
      .execute();

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  public deleteOrganization(organizationId: string) {
    return this.db.transaction(async (tx) => {
      const oidcRepo = new OidcRepository(tx);
      await oidcRepo.deleteOidcProvider({ organizationId });

      // Delete organization from db
      await this.db.delete(organizations).where(eq(organizations.id, organizationId)).execute();
    });
  }

  public async updateUserRole(input: {
    orgMemberID: string;
    organizationID: string;
    role: MemberRole;
    previousRole: MemberRole;
  }) {
    await this.db
      .update(organizationMemberRoles)
      .set({ role: input.role })
      .where(
        and(
          eq(organizationMemberRoles.organizationMemberId, input.orgMemberID),
          eq(organizationMemberRoles.role, input.previousRole),
        ),
      );
  }

  public async getOrganizationAdmins(input: { organizationID: string }): Promise<OrganizationMemberDTO[]> {
    const orgAdmins: OrganizationMemberDTO[] = [];
    const orgMembers = await this.getMembers({ organizationID: input.organizationID });

    for (const member of orgMembers) {
      if (member.roles.includes('admin')) {
        orgAdmins.push(member);
      }
    }

    return orgAdmins;
  }

  public async createIntegration(input: {
    organizationId: string;
    endpoint: string;
    name: string;
    type: string;
    events: string[];
    eventsMeta: EventMeta[];
  }) {
    await this.db.transaction(async (tx) => {
      switch (input.type) {
        case 'slack': {
          const createSlackIntegrationResult = await tx
            .insert(organizationIntegrations)
            .values({
              organizationId: input.organizationId,
              name: input.name,
              type: 'slack',
              events: input.events,
            })
            .returning()
            .execute();

          const slackIntegrationConfig = await tx
            .insert(slackIntegrationConfigs)
            .values({
              integrationId: createSlackIntegrationResult[0].id,
              endpoint: input.endpoint,
            })
            .returning()
            .execute();

          for (const eventMeta of input.eventsMeta) {
            switch (eventMeta.meta.case) {
              case 'federatedGraphSchemaUpdated':
              case 'monographSchemaUpdated': {
                const ids = eventMeta.meta.value.graphIds;

                if (ids.length === 0) {
                  continue;
                }

                await tx.insert(slackSchemaUpdateEventConfigs).values(
                  ids.map((id) => ({
                    slackIntegrationConfigId: slackIntegrationConfig[0].id,
                    federatedGraphId: id,
                  })),
                );
                break;
              }
              default: {
                throw new Error(`This event ${eventMeta.meta.case} does not exist`);
              }
            }
          }
        }
      }
    });
  }

  public async getIntegrationByName(organizationId: string, integrationName: string): Promise<Integration | undefined> {
    const res = await this.db.query.organizationIntegrations.findFirst({
      where: and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.name, integrationName),
      ),
    });

    if (!res) {
      return undefined;
    }

    switch (res.type) {
      case integrationTypeEnum.enumValues[0]: {
        const slackIntegrationConfig = await this.db.query.slackIntegrationConfigs.findFirst({
          where: eq(slackIntegrationConfigs.integrationId, res.id),
          with: {
            slackSchemaUpdateEventConfigs: true,
          },
        });

        if (!slackIntegrationConfig) {
          return undefined;
        }

        const config: PartialMessage<IntegrationConfig> = {
          type: IntegrationType.SLACK,
          config: {
            case: 'slackIntegrationConfig',
            value: {
              endpoint: slackIntegrationConfig.endpoint,
            },
          },
        };

        return {
          id: res.id,
          name: res.name,
          type: res.type,
          events: res.events || [],
          integrationConfig: config,
          eventsMeta: [
            {
              eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
              meta: {
                case: 'federatedGraphSchemaUpdated',
                value: {
                  graphIds: slackIntegrationConfig.slackSchemaUpdateEventConfigs.map((i) => i.federatedGraphId),
                },
              },
            },
          ],
        } as Integration;
      }
      default: {
        throw new Error(`The type of the integration ${res.type} doesnt exist`);
      }
    }
  }

  public async getIntegrations(organizationId: string): Promise<Integration[]> {
    const res = await this.db.query.organizationIntegrations.findMany({
      where: eq(organizationIntegrations.organizationId, organizationId),
      orderBy: (integrations, { desc }) => [desc(integrations.createdAt)],
    });

    const orgIntegrations: Integration[] = [];

    for (const r of res) {
      switch (r.type) {
        case integrationTypeEnum.enumValues[0]: {
          const slackIntegrationConfig = await this.db.query.slackIntegrationConfigs.findFirst({
            where: eq(slackIntegrationConfigs.integrationId, r.id),
            with: {
              slackSchemaUpdateEventConfigs: true,
            },
          });
          if (!slackIntegrationConfig) {
            continue;
          }

          const config: PartialMessage<IntegrationConfig> = {
            type: IntegrationType.SLACK,
            config: {
              case: 'slackIntegrationConfig',
              value: {
                endpoint: slackIntegrationConfig.endpoint,
              },
            },
          };

          const fedGraphRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
          const federatedGraphIds = [];
          const monographIds = [];

          for (const graphId of slackIntegrationConfig.slackSchemaUpdateEventConfigs.map((i) => i.federatedGraphId)) {
            const graph = await fedGraphRepo.byId(graphId);

            if (!graph) {
              continue;
            }

            if (graph.supportsFederation) {
              federatedGraphIds.push(graph.id);
            } else {
              monographIds.push(graph.id);
            }
          }

          orgIntegrations.push({
            id: r.id,
            name: r.name,
            type: r.type,
            events: r.events || [],
            integrationConfig: config,
            eventsMeta: [
              {
                eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
                meta: {
                  case: 'federatedGraphSchemaUpdated',
                  value: {
                    graphIds: federatedGraphIds,
                  },
                },
              },
              {
                eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
                meta: {
                  case: 'monographSchemaUpdated',
                  value: {
                    graphIds: monographIds,
                  },
                },
              },
            ],
          } as Integration);

          break;
        }
        default: {
          throw new Error(`The type of the integration ${r.type} doesnt exist`);
        }
      }
    }

    return orgIntegrations;
  }

  public getIntegration(id: string, organizationId: string) {
    return this.db.query.organizationIntegrations.findFirst({
      where: and(eq(organizationIntegrations.id, id), eq(organizationIntegrations.organizationId, organizationId)),
    });
  }

  public updateIntegrationConfig(input: {
    id: string;
    organizationId: string;
    endpoint: string;
    events: string[];
    eventsMeta: EventMeta[];
  }) {
    return this.db.transaction(async (tx) => {
      const integration = await tx
        .update(organizationIntegrations)
        .set({
          events: input.events,
        })
        .where(eq(organizationIntegrations.id, input.id))
        .returning();

      if (integration.length === 0) {
        return;
      }

      switch (integration[0].type) {
        case 'slack': {
          const slackIntegrationConfig = await tx
            .update(slackIntegrationConfigs)
            .set({
              endpoint: input.endpoint,
            })
            .where(eq(slackIntegrationConfigs.integrationId, integration[0].id))
            .returning()
            .execute();

          const graphIds: string[] = [];
          for (const eventMeta of input.eventsMeta) {
            switch (eventMeta.meta.case) {
              case 'federatedGraphSchemaUpdated':
              case 'monographSchemaUpdated': {
                graphIds.push(...eventMeta.meta.value.graphIds);
              }
            }
          }

          await tx
            .delete(slackSchemaUpdateEventConfigs)
            .where(
              and(
                eq(slackSchemaUpdateEventConfigs.slackIntegrationConfigId, slackIntegrationConfig[0].id),
                graphIds.length > 0
                  ? not(inArray(schema.slackSchemaUpdateEventConfigs.federatedGraphId, graphIds))
                  : undefined,
              ),
            );

          for (const eventMeta of input.eventsMeta) {
            switch (eventMeta.meta.case) {
              case 'federatedGraphSchemaUpdated':
              case 'monographSchemaUpdated': {
                const ids = eventMeta.meta.value.graphIds;
                if (ids.length === 0) {
                  break;
                }

                await tx
                  .insert(slackSchemaUpdateEventConfigs)
                  .values(
                    ids.map((id) => ({
                      slackIntegrationConfigId: slackIntegrationConfig[0].id,
                      federatedGraphId: id,
                    })),
                  )
                  .onConflictDoNothing()
                  .execute();

                break;
              }
            }
          }
        }
      }

      return integration;
    });
  }

  public async deleteIntegration(input: { id: string; organizationId: string }) {
    await this.db
      .delete(organizationIntegrations)
      .where(
        and(
          eq(organizationIntegrations.id, input.id),
          eq(organizationIntegrations.organizationId, input.organizationId),
        ),
      );
  }

  public async getOrganizationFeatures(input: {
    organizationID: string;
  }): Promise<{ [key in FeatureIds]: number | boolean }> {
    const features = await this.getFeatures({ organizationId: input.organizationID });

    // Full list of features with default values
    const list: { [key in FeatureIds]: number | boolean } = {
      'analytics-retention': 30,
      'tracing-retention': 30,
      'changelog-retention': 30,
      'breaking-change-retention': 90,
      'trace-sampling-rate': 1,
      'federated-graphs': 30,
      'feature-flags': 0,
      users: 25,
      requests: 30,
      rbac: false,
      sso: false,
      security: false,
      support: false,
      oidc: false,
      ai: false,
      scim: false,
    };

    for (const feature of features) {
      // Only override the limit if the feature is enabled with a valid limit
      if (feature.enabled && feature.limit && feature.limit > 0) {
        list[feature.id] = feature.limit;
      } else if (typeof list[feature.id] === 'boolean') {
        // Enable or disable the boolean feature
        list[feature.id] = feature.enabled || false;
      }
    }

    return list;
  }

  public async adminMemberships({ userId }: { userId: string }) {
    const orgs = await this.memberships({ userId });

    const orgsWhereUserIsAdmin = orgs.filter((o) => o.roles.includes('admin'));

    // We need to track these orgs to delete them since the user is the only member.
    const soloAdminSoloMemberOrgs: OrganizationDTO[] = [];

    // A user who is an admin can only be deleted if the organization has another admin as well.
    // We keep track of cases where the user is the only admin to inform the actor
    const soloAdminManyMembersOrgs: OrganizationDTO[] = [];

    for (const org of orgsWhereUserIsAdmin) {
      const members = await this.getMembers({
        organizationID: org.id,
      });

      if (members.length === 1) {
        soloAdminSoloMemberOrgs.push(org);
        continue;
      }

      const admins = members.filter((m) => m.roles.includes('admin'));
      if (admins.length === 1) {
        soloAdminManyMembersOrgs.push(org);
      }
    }

    return {
      soloAdminSoloMemberOrgs,
      soloAdminManyMembersOrgs,
      memberships: orgs,
    };
  }

  /***
   * Checks if the user can be deleted.
   * It returns with isSafe=false if the user is the only admin of one or more multi member organizations along with said organizations.
   * It also returns organizations where the user is the only member.
   */
  public async canUserBeDeleted(id: string): Promise<{
    isSafe: boolean;
    soloOrganizations: OrganizationDTO[];
    unsafeOrganizations: OrganizationDTO[];
  }> {
    const { soloAdminManyMembersOrgs, soloAdminSoloMemberOrgs } = await this.adminMemberships({
      userId: id,
    });

    const isSafe = soloAdminManyMembersOrgs.length === 0;

    return {
      isSafe,
      soloOrganizations: soloAdminSoloMemberOrgs,
      unsafeOrganizations: soloAdminManyMembersOrgs,
    };
  }

  /***
   * Cancels Subscription
   * Removes any feature overrides
   * Sets deactivated to true.
   * Schedules deletion.
   */
  public async deactivateOrganization(input: {
    organizationId: string;
    reason?: string;
    keycloakClient: Keycloak;
    keycloakRealm: string;
    deleteOrganizationQueue: DeleteOrganizationQueue;
  }) {
    const billingRepo = new BillingRepository(this.db);
    await billingRepo.cancelSubscription(input.organizationId);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.organizationFeatures)
        .where(eq(schema.organizationFeatures.organizationId, input.organizationId));

      await tx
        .update(schema.organizations)
        .set({
          isDeactivated: true,
          deactivatedAt: new Date(),
          deactivationReason: input.reason,
        })
        .where(eq(schema.organizations.id, input.organizationId));
    });

    const now = new Date();
    const oneMonthFromNow = addDays(now, 30);
    const delay = Number(oneMonthFromNow) - Number(now);

    return input.deleteOrganizationQueue.addJob(
      {
        organizationId: input.organizationId,
      },
      {
        delay,
      },
    );
  }

  public async reactivateOrganization(input: {
    organizationId: string;
    deleteOrganizationQueue: DeleteOrganizationQueue;
  }) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.organizations)
        .set({
          isDeactivated: false,
          deactivatedAt: null,
          deactivationReason: null,
        })
        .where(eq(schema.organizations.id, input.organizationId));
    });

    return input.deleteOrganizationQueue.removeJob({
      organizationId: input.organizationId,
    });
  }

  public async getWebhookHistory(input: {
    organizationID: string;
    filterByType?: string;
    offset?: number;
    limit?: number;
    startDate: string;
    endDate: string;
  }): Promise<{ deliveries: PlainMessage<WebhookDelivery>[]; totalCount: number }> {
    const conditions = and(
      eq(schema.webhookDeliveries.organizationId, input.organizationID),
      gt(schema.webhookDeliveries.createdAt, new Date(input.startDate)),
      lt(schema.webhookDeliveries.createdAt, new Date(input.endDate)),
      input.filterByType
        ? eq(schema.webhookDeliveries.type, input.filterByType as (typeof schema.webhookDeliveryType.enumValues)[0])
        : undefined,
    );

    const res = await this.db.query.webhookDeliveries.findMany({
      where: conditions,
      offset: input.offset,
      limit: input.limit,
      orderBy: desc(schema.webhookDeliveries.createdAt),
      with: {
        user: {
          columns: {
            email: true,
          },
        },
      },
    });

    const totalCount = (await this.db.select({ count: count() }).from(schema.webhookDeliveries).where(conditions))[0]
      .count;

    const deliveries = res.map((r) => ({
      ...r,
      createdBy: r.user?.email || undefined,
      isRedelivery: !!r.originalDeliveryId,
      createdAt: r.createdAt.toISOString(),
      requestHeaders: JSON.stringify(r.requestHeaders),
      responseHeaders: r.responseHeaders ? JSON.stringify(r.responseHeaders) : undefined,
      responseStatusCode: r.responseStatusCode || undefined,
      responseErrorCode: r.responseErrorCode || undefined,
      responseBody: r.responseBody || undefined,
      errorMessage: r.errorMessage || undefined,
    }));

    return { deliveries, totalCount };
  }

  getWebhookDeliveryById(id: string, organizationId: string) {
    return this.db.query.webhookDeliveries.findFirst({
      where: and(eq(schema.webhookDeliveries.id, id), eq(schema.webhookDeliveries.organizationId, organizationId)),
      with: {
        user: {
          columns: {
            email: true,
          },
        },
      },
    });
  }
}
