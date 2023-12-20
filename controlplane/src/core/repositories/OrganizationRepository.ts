import { PartialMessage, PlainMessage } from '@bufbuild/protobuf';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import {
  Integration,
  IntegrationConfig,
  IntegrationType,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, asc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { MemberRole } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import {
  apiKeys,
  integrationTypeEnum,
  organizationIntegrations,
  organizationLimits,
  organizationMemberRoles,
  organizationWebhooks,
  organizations,
  organizationsMembers,
  slackIntegrationConfigs,
  slackSchemaUpdateEventConfigs,
  targets,
  users,
  organizationFeatures,
  organizationBilling,
  subscriptions,
} from '../../db/schema.js';
import {
  BillingPlans,
  Feature,
  OrganizationDTO,
  OrganizationLimitsDTO,
  OrganizationMemberDTO,
  WebhooksConfigDTO,
} from '../../types/index.js';

const defaultPlan = 'developer';

/**
 * Repository for organization related operations.
 */
export class OrganizationRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

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

    return {
      id: insertedOrg[0].id,
      name: insertedOrg[0].name,
      slug: insertedOrg[0].slug,
      creatorUserId: insertedOrg[0].createdBy,
      createdAt: insertedOrg[0].createdAt.toISOString(),
      billing: {
        plan: defaultPlan,
      },
    };
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
          status: subscriptions.status,
        },
      })
      .from(organizations)
      .leftJoin(organizationBilling, eq(organizations.id, organizationBilling.organizationId))
      .leftJoin(subscriptions, eq(organizations.id, subscriptions.organizationId))
      .where(eq(organizations.slug, slug))
      .limit(1)
      .execute();

    if (org.length === 0) {
      return null;
    }

    return {
      id: org[0].id,
      name: org[0].name,
      slug: org[0].slug,
      creatorUserId: org[0].creatorUserId,
      createdAt: org[0].createdAt.toISOString(),
      billing: {
        plan: org[0].billing?.plan || defaultPlan,
      },
      subscription: org[0].subscription
        ? {
            status: org[0].subscription.status,
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
          status: subscriptions.status,
        },
      })
      .from(organizations)
      .leftJoin(organizationBilling, eq(organizations.id, organizationBilling.organizationId))
      .leftJoin(subscriptions, eq(organizations.id, subscriptions.organizationId))
      .where(eq(organizations.id, id))
      .limit(1)
      .execute();

    if (org.length === 0) {
      return null;
    }

    return {
      id: org[0].id,
      name: org[0].name,
      slug: org[0].slug,
      creatorUserId: org[0].creatorUserId,
      createdAt: org[0].createdAt.toISOString(),
      billing: {
        plan: org[0].billing?.plan || defaultPlan,
      },
      subscription: org[0].subscription
        ? {
            status: org[0].subscription.status,
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

  public async memberships(input: {
    userId: string;
  }): Promise<(OrganizationDTO & { roles: string[]; limits: OrganizationLimitsDTO })[]> {
    const userOrganizations = await this.db
      .selectDistinctOn([organizations.id], {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
        limits: {
          users: organizationLimits.users,
          graphs: organizationLimits.graphs,
          analyticsRetentionLimit: organizationLimits.analyticsRetentionLimit,
          tracingRetentionLimit: organizationLimits.tracingRetentionLimit,
          breakingChangeRetentionLimit: organizationLimits.breakingChangeRetentionLimit,
          changelogDataRetentionLimit: organizationLimits.changelogDataRetentionLimit,
          traceSamplingRateLimit: organizationLimits.traceSamplingRateLimit,
          requestsLimit: organizationLimits.requestsLimit,
        },
        billing: {
          plan: organizationBilling.plan,
          email: organizationBilling.email,
        },
        subscription: {
          status: subscriptions.status,
          trialEnd: subscriptions.trialEnd,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        },
      })
      .from(organizationsMembers)
      .innerJoin(organizations, eq(organizations.id, organizationsMembers.organizationId))
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .innerJoin(organizationLimits, eq(organizations.id, organizationLimits.organizationId))
      .leftJoin(organizationBilling, eq(organizations.id, organizationBilling.organizationId))
      .leftJoin(subscriptions, eq(organizations.id, subscriptions.organizationId))
      .where(eq(users.id, input.userId))
      .execute();

    const userMemberships = await Promise.all(
      userOrganizations.map(async (org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        creatorUserId: org.creatorUserId,
        createdAt: org.createdAt.toISOString(),
        roles: await this.getOrganizationMemberRoles({
          userID: input.userId,
          organizationID: org.id,
        }),
        limits: {
          users: org.limits.users,
          graphs: org.limits.graphs,
          analyticsRetentionLimit: org.limits.analyticsRetentionLimit,
          tracingRetentionLimit: org.limits.tracingRetentionLimit,
          breakingChangeRetentionLimit: org.limits.breakingChangeRetentionLimit,
          changelogDataRetentionLimit: org.limits.changelogDataRetentionLimit,
          traceSamplingRateLimit: Number(org.limits.traceSamplingRateLimit),
          requestsLimit: org.limits.requestsLimit,
        },
        features: await this.getFeatures({ organizationId: org.id }),
        billing: {
          plan: org.billing?.plan || defaultPlan,
          email: org.billing?.email || undefined,
        },
        subscription: org.subscription
          ? {
              status: org.subscription.status,
              trialEnd: org.subscription.trialEnd?.toISOString(),
              cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
              currentPeriodEnd: org.subscription.currentPeriodEnd?.toISOString(),
            }
          : undefined,
      })),
    );

    return userMemberships;
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
    } as OrganizationMemberDTO;
  }

  public async getMembers(input: { organizationID: string }): Promise<OrganizationMemberDTO[]> {
    const orgMembers = await this.db
      .select({
        userID: users.id,
        email: users.email,
        memberID: organizationsMembers.id,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(eq(organizationsMembers.organizationId, input.organizationID))
      .orderBy(asc(organizationsMembers.createdAt))
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

  public async getFeatures(input: { organizationId: string }): Promise<Feature[]> {
    const features = await this.db
      .select({
        feature: organizationFeatures.feature,
        enabled: organizationFeatures.enabled,
        limit: organizationFeatures.limit,
      })
      .from(organizationFeatures)
      .where(eq(organizationFeatures.organizationId, input.organizationId))
      .execute();

    return features.map((feature) => ({
      id: feature.feature,
      enabled: feature.enabled,
      limit: feature.limit,
    }));
  }

  public async updateFeature(
    input: {
      organizationId: string;
    } & Feature,
  ) {
    const feature: any = {
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
        target: organizationFeatures.id,
        set: feature,
      })
      .execute();
  }

  public async isFeatureEnabled(id: string, featureId: string) {
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
  }) {
    await this.db.transaction(async (tx) => {
      const createWebhookResult = await tx
        .insert(organizationWebhooks)
        .values({
          organizationId: input.organizationId,
          endpoint: input.endpoint,
          events: input.events,
          key: input.key,
        })
        .returning();

      if (!input.eventsMeta) {
        return;
      }

      for (const eventMeta of input.eventsMeta) {
        switch (eventMeta.meta.case) {
          case 'federatedGraphSchemaUpdated': {
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

    meta.push({
      eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
      meta: {
        case: 'federatedGraphSchemaUpdated',
        value: {
          graphIds: results.map((r) => r.graphId),
        },
      },
    });

    return meta as PlainMessage<EventMeta>[];
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

      await tx.update(organizationWebhooks).set(set).where(eq(organizationWebhooks.id, input.id));

      if (!input.eventsMeta) {
        return;
      }

      for (const eventMeta of input.eventsMeta) {
        switch (eventMeta.meta.case) {
          case 'federatedGraphSchemaUpdated': {
            const graphIds = eventMeta.meta.value.graphIds;
            await tx
              .delete(schema.webhookGraphSchemaUpdate)
              .where(and(eq(schema.webhookGraphSchemaUpdate.webhookId, input.id)));
            if (graphIds.length === 0) {
              break;
            }
            await tx
              .insert(schema.webhookGraphSchemaUpdate)
              .values(
                graphIds.map((id) => ({
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
    await this.db
      .delete(organizationWebhooks)
      .where(and(eq(organizationWebhooks.id, input.id), eq(organizationWebhooks.organizationId, input.organizationId)));
  }

  public async deleteOrganization(organizationID: string) {
    await this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(tx);

      await orgRepo.deleteOrganizationResources(organizationID);

      await tx.delete(organizations).where(eq(organizations.id, organizationID)).execute();
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

  public async deleteOrganizationResources(organizationID: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(apiKeys).where(eq(apiKeys.organizationId, organizationID)).execute();
      await tx.delete(targets).where(eq(targets.organizationId, organizationID)).execute();
    });
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
              case 'federatedGraphSchemaUpdated': {
                const ids = eventMeta.meta.value.graphIds;
                await tx.insert(slackSchemaUpdateEventConfigs).values(
                  ids.map((id) => ({
                    slackIntegrationConfigId: slackIntegrationConfig[0].id,
                    federatedGraphId: id,
                  })),
                );
                break;
              }
              default: {
                throw new Error(`This event ${eventMeta.meta.case} doesnt exist`);
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
            slackSchemUpdateEventConfigs: true,
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
                  graphIds: slackIntegrationConfig.slackSchemUpdateEventConfigs.map((i) => i.federatedGraphId),
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
              slackSchemUpdateEventConfigs: true,
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
                    graphIds: slackIntegrationConfig.slackSchemUpdateEventConfigs.map((i) => i.federatedGraphId),
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

  public async updateIntegrationConfig(input: {
    id: string;
    organizationId: string;
    endpoint: string;
    events: string[];
    eventsMeta: EventMeta[];
  }) {
    await this.db.transaction(async (tx) => {
      const integration = await tx
        .update(organizationIntegrations)
        .set({
          events: input.events,
        })
        .where(eq(organizationIntegrations.id, input.id))
        .returning();

      switch (integration[0].type) {
        case 'slack': {
          const slackIntegrationConfig = await tx
            .update(slackIntegrationConfigs)
            .set({
              endpoint: input.endpoint,
            })
            .returning()
            .execute();

          // if the meta is not sent, we delete all the existing event configs
          if (input.eventsMeta.length === 0) {
            await tx
              .delete(slackSchemaUpdateEventConfigs)
              .where(and(eq(slackSchemaUpdateEventConfigs.slackIntegrationConfigId, slackIntegrationConfig[0].id)));
          }

          for (const eventMeta of input.eventsMeta) {
            switch (eventMeta.meta.case) {
              case 'federatedGraphSchemaUpdated': {
                await tx
                  .delete(slackSchemaUpdateEventConfigs)
                  .where(and(eq(slackSchemaUpdateEventConfigs.slackIntegrationConfigId, slackIntegrationConfig[0].id)));

                const ids = eventMeta.meta.value.graphIds;
                if (ids.length === 0) {
                  break;
                }

                await tx.insert(slackSchemaUpdateEventConfigs).values(
                  ids.map((id) => ({
                    slackIntegrationConfigId: slackIntegrationConfig[0].id,
                    federatedGraphId: id,
                  })),
                );

                break;
              }
            }
          }
        }
      }
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

  public async addOrganizationLimits(input: {
    organizationID: string;
    analyticsRetentionLimit: number;
    tracingRetentionLimit: number;
    changelogDataRetentionLimit: number;
    breakingChangeRetentionLimit: number;
    traceSamplingRateLimit: number;
    requestsLimit: number;
  }) {
    await this.db
      .insert(organizationLimits)
      .values({
        requestsLimit: input.requestsLimit,
        analyticsRetentionLimit: input.analyticsRetentionLimit,
        tracingRetentionLimit: input.tracingRetentionLimit,
        breakingChangeRetentionLimit: input.breakingChangeRetentionLimit,
        changelogDataRetentionLimit: input.changelogDataRetentionLimit,
        traceSamplingRateLimit: input.traceSamplingRateLimit.toString(),
        organizationId: input.organizationID,
      })
      .execute();
  }

  public async addOrganizationBilling(input: { organizationID: string; email: string; plan: BillingPlans }) {
    await this.db
      .insert(organizationBilling)
      .values({
        organizationId: input.organizationID,
        plan: input.plan,
        email: input.email,
      })
      .execute();
  }

  public async getOrganizationLimits(input: { organizationID: string }): Promise<OrganizationLimitsDTO> {
    const limits = await this.db
      .select({
        analyticsRetentionLimit: organizationLimits.analyticsRetentionLimit,
        tracingRetentionLimit: organizationLimits.tracingRetentionLimit,
        breakingChangeRetentionLimit: organizationLimits.breakingChangeRetentionLimit,
        changelogDataRetentionLimit: organizationLimits.changelogDataRetentionLimit,
        traceSamplingRateLimit: organizationLimits.traceSamplingRateLimit,
        requestsLimit: organizationLimits.requestsLimit,
      })
      .from(organizationLimits)
      .where(eq(organizationLimits.organizationId, input.organizationID))
      .limit(1)
      .execute();

    if (limits.length === 0) {
      return {
        analyticsRetentionLimit: 7,
        tracingRetentionLimit: 7,
        changelogDataRetentionLimit: 7,
        breakingChangeRetentionLimit: 7,
        traceSamplingRateLimit: 0.1,
        requestsLimit: 10,
      };
    }

    return {
      analyticsRetentionLimit: limits[0].analyticsRetentionLimit,
      tracingRetentionLimit: limits[0].tracingRetentionLimit,
      changelogDataRetentionLimit: limits[0].changelogDataRetentionLimit,
      breakingChangeRetentionLimit: limits[0].breakingChangeRetentionLimit,
      requestsLimit: limits[0].requestsLimit,
      traceSamplingRateLimit: Number.parseFloat(limits[0].traceSamplingRateLimit),
    };
  }
}
