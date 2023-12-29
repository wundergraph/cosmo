import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  bigint,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  unique,
  customType,
  real,
} from 'drizzle-orm/pg-core';

// JSON/JSONB custom types to workaround insert bug
// Should not be used with other drivers than postgres-js
// See https://github.com/drizzle-team/drizzle-orm/issues/724
export const customJson = <TData>(name: string) =>
  customType<{ data: TData; driverData: TData }>({
    dataType() {
      return 'json';
    },
    toDriver(val: TData) {
      return val;
    },
    fromDriver(value): TData {
      return value as TData;
    },
  })(name);
export const customJsonb = <TData>(name: string) =>
  customType<{ data: TData; driverData: TData }>({
    dataType() {
      return 'jsonb';
    },
    toDriver(val: TData) {
      return val;
    },
    fromDriver(value): TData {
      return value as TData;
    },
  })(name);

export const federatedGraphs = pgTable('federated_graphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  routingUrl: text('routing_url').notNull(),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, {
      onDelete: 'cascade',
    }),
  // This is the latest valid composed schema of the federated graph. Only set for a static composition of subgraphs.
  composedSchemaVersionId: uuid('composed_schema_version_id').references(() => schemaVersion.id, {
    onDelete: 'no action',
  }),
});

export const federatedGraphClients = pgTable(
  'federated_graph_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    updatedById: uuid('updated_by_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => ({
    uniqueFederatedGraphClientName: unique('federated_graph_client_name').on(t.federatedGraphId, t.name),
  }),
);

export const federatedGraphClientsRelations = relations(federatedGraphClients, ({ one }) => ({
  createdBy: one(users, {
    fields: [federatedGraphClients.createdById],
    references: [users.id],
  }),
  updatedBy: one(users, {
    fields: [federatedGraphClients.updatedById],
    references: [users.id],
  }),
}));

export const federatedGraphPersistedOperations = pgTable(
  'federated_graph_persisted_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => federatedGraphClients.id, {
        onDelete: 'cascade',
      }),
    // operationId indicated by the client
    operationId: text('operation_id').notNull(),
    // sha256 hash of the operation body, calculated by us
    hash: text('hash').notNull(),
    // path in the blob storage where the operation is stored
    filePath: text('file_path').notNull().unique(),
    operationNames: text('operation_names').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    operationContent: text('operation_content'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    updatedById: uuid('updated_by_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => ({
    uniqueFederatedGraphClientIdOperationId: unique('federated_graph_operation_id').on(
      t.federatedGraphId,
      t.clientId,
      t.operationId,
    ),
  }),
);

export const federatedGraphPersistedOperationsRelations = relations(
  federatedGraphPersistedOperations,
  ({ many, one }) => ({
    createdBy: one(users, {
      fields: [federatedGraphPersistedOperations.createdById],
      references: [users.id],
    }),
    updatedBy: one(users, {
      fields: [federatedGraphPersistedOperations.updatedById],
      references: [users.id],
    }),
  }),
);

export const subscriptionProtocolEnum = pgEnum('subscription_protocol', ['ws', 'sse', 'sse_post'] as const);

export const subgraphs = pgTable('subgraphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  routingUrl: text('routing_url').notNull(),
  subscriptionUrl: text('subscription_url'),
  subscriptionProtocol: subscriptionProtocolEnum('subscription_protocol').notNull().default('ws'),
  // This is the latest valid schema of the subgraph.
  schemaVersionId: uuid('schema_version_id').references(() => schemaVersion.id, {
    onDelete: 'no action',
  }),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, {
      onDelete: 'cascade',
    }),
});

export const federatedGraphRelations = relations(federatedGraphs, ({ many, one }) => ({
  target: one(targets, {
    fields: [federatedGraphs.targetId],
    references: [targets.id],
  }),
  composedSchemaVersion: one(schemaVersion, {
    fields: [federatedGraphs.composedSchemaVersionId],
    references: [schemaVersion.id],
  }),
  subgraphs: many(subgraphsToFederatedGraph),
}));

export const subgraphRelations = relations(subgraphs, ({ many, one }) => ({
  federatedGraphs: many(subgraphsToFederatedGraph),
  schemaVersion: one(schemaVersion, {
    fields: [subgraphs.schemaVersionId],
    references: [schemaVersion.id],
  }),
  target: one(targets, {
    fields: [subgraphs.targetId],
    references: [targets.id],
  }),
}));

export const subgraphsToFederatedGraph = pgTable(
  'federated_subgraphs',
  {
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    subgraphId: uuid('subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
  },
  (t) => {
    return {
      pk: primaryKey(t.federatedGraphId, t.subgraphId),
    };
  },
);

export const federatedGraphToSubgraphsRelations = relations(subgraphsToFederatedGraph, ({ one }) => ({
  subgraph: one(subgraphs, {
    fields: [subgraphsToFederatedGraph.subgraphId],
    references: [subgraphs.id],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [subgraphsToFederatedGraph.federatedGraphId],
    references: [federatedGraphs.id],
  }),
}));

export const targetTypeEnum = pgEnum('target_type', ['federated', 'subgraph', 'graph'] as const);

export const targets = pgTable(
  'targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: targetTypeEnum('type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    labels: text('labels').array(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    readme: text('readme'),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_name_idx').on(t.organizationId, t.name),
      // Currently, not supported by drizzle-orm
      // https://github.com/drizzle-team/drizzle-orm/issues/817
      // We create them in a custom migration
      // labelIndex: index("label_idx")
      //   .on(t.labels)
      //   .using(sql`GIN`),
    };
  },
);

export const targetLabelMatchers = pgTable(
  'target_label_matchers',
  {
    targetId: uuid('target_id')
      .notNull()
      .references(() => targets.id, {
        onDelete: 'cascade',
      }),
    labelMatcher: text('label_matcher').array().notNull(),
  },
  (t) => {
    return {
      // Currently, not supported by drizzle-orm
      // https://github.com/drizzle-team/drizzle-orm/issues/817
      // We create them in a custom migration
      // labelMatcherIndex: index("label_matcher_idx")
      //   .on(t.labelMatcher)
      //   .using(sql`GIN`),
    };
  },
);

export const targetLabelMatchersRelations = relations(targetLabelMatchers, ({ one }) => ({
  target: one(targets, {
    fields: [targetLabelMatchers.targetId],
    references: [targets.id],
  }),
}));

export const targetsRelations = relations(targets, ({ one, many }) => ({
  subgraph: one(subgraphs, {
    fields: [targets.id],
    references: [subgraphs.targetId],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [targets.id],
    references: [federatedGraphs.targetId],
  }),
  labelMatchers: many(targetLabelMatchers),
}));

export const schemaVersion = pgTable('schema_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, {
      onDelete: 'cascade',
    }),
  // The actual schema definition of the graph. For GraphQL, this is the SDL.
  // For a monolithic GraphQL, it is the SDL.
  // For a federated Graph, this is the composition result.
  schemaSDL: text('schema_sdl'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// https://github.com/kamilkisiela/graphql-inspector/blob/f3b9ed7e277f1a4928da7d0fdc212685ff77752a/packages/core/src/diff/changes/change.ts
export const schemaChangeTypeEnum = pgEnum('schema_change_type', [
  'FIELD_ARGUMENT_DESCRIPTION_CHANGED',
  'FIELD_ARGUMENT_DEFAULT_CHANGED',
  'FIELD_ARGUMENT_TYPE_CHANGED',
  'DIRECTIVE_REMOVED',
  'DIRECTIVE_ADDED',
  'DIRECTIVE_DESCRIPTION_CHANGED',
  'DIRECTIVE_LOCATION_ADDED',
  'DIRECTIVE_LOCATION_REMOVED',
  'DIRECTIVE_ARGUMENT_ADDED',
  'DIRECTIVE_ARGUMENT_REMOVED',
  'DIRECTIVE_ARGUMENT_DESCRIPTION_CHANGED',
  'DIRECTIVE_ARGUMENT_DEFAULT_VALUE_CHANGED',
  'DIRECTIVE_ARGUMENT_TYPE_CHANGED',
  'ENUM_VALUE_REMOVED',
  'ENUM_VALUE_ADDED',
  'ENUM_VALUE_DESCRIPTION_CHANGED',
  'ENUM_VALUE_DEPRECATION_REASON_CHANGED',
  'ENUM_VALUE_DEPRECATION_REASON_ADDED',
  'ENUM_VALUE_DEPRECATION_REASON_REMOVED',
  'FIELD_REMOVED',
  'FIELD_ADDED',
  'FIELD_DESCRIPTION_CHANGED',
  'FIELD_DESCRIPTION_ADDED',
  'FIELD_DESCRIPTION_REMOVED',
  'FIELD_DEPRECATION_ADDED',
  'FIELD_DEPRECATION_REMOVED',
  'FIELD_DEPRECATION_REASON_CHANGED',
  'FIELD_DEPRECATION_REASON_ADDED',
  'FIELD_DEPRECATION_REASON_REMOVED',
  'FIELD_TYPE_CHANGED',
  'FIELD_ARGUMENT_ADDED',
  'FIELD_ARGUMENT_REMOVED',
  'INPUT_FIELD_REMOVED',
  'INPUT_FIELD_ADDED',
  'INPUT_FIELD_DESCRIPTION_ADDED',
  'INPUT_FIELD_DESCRIPTION_REMOVED',
  'INPUT_FIELD_DESCRIPTION_CHANGED',
  'INPUT_FIELD_DEFAULT_VALUE_CHANGED',
  'INPUT_FIELD_TYPE_CHANGED',
  'OBJECT_TYPE_INTERFACE_ADDED',
  'OBJECT_TYPE_INTERFACE_REMOVED',
  'SCHEMA_QUERY_TYPE_CHANGED',
  'SCHEMA_MUTATION_TYPE_CHANGED',
  'SCHEMA_SUBSCRIPTION_TYPE_CHANGED',
  'TYPE_REMOVED',
  'TYPE_ADDED',
  'TYPE_KIND_CHANGED',
  'TYPE_DESCRIPTION_CHANGED',
  'TYPE_DESCRIPTION_REMOVED',
  'TYPE_DESCRIPTION_ADDED',
  'UNION_MEMBER_REMOVED',
  'UNION_MEMBER_ADDED',
] as const);

export const schemaVersionChangeAction = pgTable('schema_version_change_action', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaVersionId: uuid('schema_version_id')
    .notNull()
    .references(() => schemaVersion.id, {
      onDelete: 'cascade',
    }),
  changeType: schemaChangeTypeEnum('change_type').notNull(),
  changeMessage: text('change_message').notNull(),
  path: text('path'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const schemaVersionChangeActionRelations = relations(schemaVersionChangeAction, ({ one }) => ({
  schemaVersion: one(schemaVersion, {
    fields: [schemaVersionChangeAction.schemaVersionId],
    references: [schemaVersion.id],
  }),
}));

export const schemaVersionRelations = relations(schemaVersion, ({ many }) => ({
  changes: many(schemaVersionChangeAction),
}));

export const schemaChecks = pgTable('schema_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, {
      onDelete: 'cascade',
    }),
  isComposable: boolean('is_composable').default(false),
  isDeleted: boolean('is_deleted').default(false),
  hasBreakingChanges: boolean('has_breaking_changes').default(false),
  hasClientTraffic: boolean('has_client_traffic').default(false),
  proposedSubgraphSchemaSDL: text('proposed_subgraph_schema_sdl'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ghDetails: customJson('gh_details').$type<{
    accountId: number;
    repositorySlug: string;
    ownerSlug: string;
    checkRunId: number;
    commitSha: string;
  }>(),
  forcedSuccess: boolean('forced_success').default(false),
});

export const schemaCheckChangeActionOperationUsage = pgTable('schema_check_change_operation_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaCheckChangeActionId: uuid('schema_check_change_action_id')
    .notNull()
    .references(() => schemaCheckChangeAction.id, {
      onDelete: 'cascade',
    }),
  name: text('name').notNull(),
  hash: text('hash').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
});

export const schemaCheckFederatedGraphs = pgTable('schema_check_federated_graphs', {
  checkId: uuid('check_id')
    .notNull()
    .references(() => schemaChecks.id, {
      onDelete: 'cascade',
    }),
  federatedGraphId: uuid('federated_graph_id')
    .notNull()
    .references(() => federatedGraphs.id, {
      onDelete: 'cascade',
    }),
  trafficCheckDays: integer('traffic_check_days').notNull(),
});

export const schemaCheckFederatedGraphsRelations = relations(schemaCheckFederatedGraphs, ({ one }) => ({
  schemaCheck: one(schemaChecks, {
    fields: [schemaCheckFederatedGraphs.checkId],
    references: [schemaChecks.id],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [schemaCheckFederatedGraphs.federatedGraphId],
    references: [federatedGraphs.id],
  }),
}));

export const schemaCheckChangeAction = pgTable('schema_check_change_action', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaCheckId: uuid('schema_check_id')
    .notNull()
    .references(() => schemaChecks.id, {
      onDelete: 'cascade',
    }),
  changeType: schemaChangeTypeEnum('change_type'),
  changeMessage: text('change_message'),
  isBreaking: boolean('is_breaking').default(false),
  path: text('path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schemaCheckChangeActionRelations = relations(schemaCheckChangeAction, ({ many }) => ({
  operationUsage: many(schemaCheckChangeActionOperationUsage),
}));

export const schemaCheckComposition = pgTable('schema_check_composition', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaCheckId: uuid('schema_check_id')
    .notNull()
    .references(() => schemaChecks.id, {
      onDelete: 'cascade',
    }),
  federatedTargetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, {
      onDelete: 'cascade',
    }),
  compositionErrors: text('composition_errors'),
  composedSchemaSDL: text('composed_schema_sdl'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schemaCheckRelations = relations(schemaChecks, ({ many }) => ({
  changes: many(schemaCheckChangeAction),
  compositions: many(schemaCheckComposition),
  affectedGraphs: many(schemaCheckFederatedGraphs),
}));

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, {
      onDelete: 'cascade',
    }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  idToken: text('id_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

/**
 * API keys are created globally and are used by the CLI, router and CI/CD systems
 * to make changes to all resources that the user has access to.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    key: text('key').unique().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('apikey_name_idx').on(t.name, t.organizationId),
    };
  },
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const graphApiTokens = pgTable(
  'graph_api_tokens',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').unique().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('graphApiToken_name_idx').on(t.name, t.federatedGraphId),
    };
  },
);

export const graphRequestKeys = pgTable('graph_request_keys', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  federatedGraphId: uuid('federated_graph_id')
    .notNull()
    // Only one request key per federated graph
    .unique()
    .references(() => federatedGraphs.id, { onDelete: 'cascade' }),
  privateKey: text('privateKey').unique().notNull(),
  publicKey: text('publicKey').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  inviteCode: text('invite_code'),
  createdBy: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationBilling = pgTable(
  'organization_billing',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    plan: text('plan'),
    email: text('email'),
    stripeCustomerId: text('stripe_customer_id'),
  },
  (t) => {
    return {
      orgIndex: uniqueIndex('organization_billing_idx').on(t.organizationId),
      stripeIndex: uniqueIndex('organization_billing_stripe_idx').on(t.stripeCustomerId),
    };
  },
);

export type Feature = {
  id: string;
  description?: string;
  limit?: number;
};

export const billingPlans = pgTable('billing_plans', {
  id: text('id').notNull().primaryKey(),
  active: boolean('active').notNull().default(true),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  features: customJson<Feature[]>('features').notNull(),
  stripePriceId: text('stripe_price_id'),
  weight: integer('weight').notNull().default(0),
});

// These statuses map directly to Stripe's subscription statuses
// @see https://stripe.com/docs/api/subscriptions/object#subscription_object-status
const statuses = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;

export const subscriptionStatusEnum = pgEnum('status', statuses);

export type SubscriptionStatus = (typeof statuses)[number];

/**
 * These are the subscriptions that are created in Stripe.
 * https://stripe.com/docs/api/subscriptions/object
 */
export const billingSubscriptions = pgTable('billing_subscriptions', {
  id: text('id').notNull().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  metadata: customJson<{ [key: string]: string }>('metadata').notNull(),
  status: subscriptionStatusEnum('status').notNull(),
  priceId: text('price_id').notNull(),
  quantity: integer('quantity').notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull(),
  cancelAt: timestamp('cancel_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  trialStart: timestamp('trial_start', { withTimezone: true }),
  trialEnd: timestamp('trial_end', { withTimezone: true }),
});

export const organizationsMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_member_idx').on(t.id),
      memberIndex: uniqueIndex('unique_organization_member_idx').on(t.userId, t.organizationId),
    };
  },
);

export const organizationRelations = relations(organizations, ({ many }) => ({
  members: many(organizationsMembers),
  graphApiTokens: many(graphApiTokens),
}));

export const memberRoleEnum = pgEnum('member_role', ['admin', 'developer', 'viewer'] as const);

export const organizationMemberRoles = pgTable(
  'organization_member_roles',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationMemberId: uuid('organization_member_id')
      .notNull()
      .references(() => organizationsMembers.id, {
        onDelete: 'cascade',
      }),
    role: memberRoleEnum('role').notNull(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_member_role_idx').on(t.organizationMemberId, t.role),
    };
  },
);

export const organizationMembersRelations = relations(organizationsMembers, ({ many }) => ({
  memberRoles: many(organizationMemberRoles),
}));

export const organizationMemberRolesRelations = relations(organizationMemberRoles, ({ one }) => ({
  member: one(organizationsMembers, {
    fields: [organizationMemberRoles.organizationMemberId],
    references: [organizationsMembers.id],
  }),
}));

export const organizationFeatures = pgTable(
  'organization_features',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    feature: text('feature').notNull(),
    enabled: boolean('enabled').default(true),
    limit: real('limit'),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_feature_idx').on(t.organizationId, t.feature),
    };
  },
);

export const organizationInvitations = pgTable('organization_invitations', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'cascade' }),
  accepted: boolean('accepted').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationWebhooks = pgTable('organization_webhook_configs', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  endpoint: text('endpoint'),
  key: text('key'),
  events: text('events').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookGraphSchemaUpdate = pgTable(
  'webhook_graph_schema_update',
  {
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => organizationWebhooks.id, {
        onDelete: 'cascade',
      }),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
  },
  (t) => {
    return {
      pk: primaryKey(t.webhookId, t.federatedGraphId),
    };
  },
);

export const webhookGraphSchemaUpdateRelations = relations(webhookGraphSchemaUpdate, ({ one }) => ({
  organizationWebhook: one(organizationWebhooks, {
    fields: [webhookGraphSchemaUpdate.webhookId],
    references: [organizationWebhooks.id],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [webhookGraphSchemaUpdate.federatedGraphId],
    references: [federatedGraphs.id],
  }),
}));

export const organizationWebhookRelations = relations(organizationWebhooks, ({ many }) => ({
  organization: many(organizations),
  webhookGraphSchemaUpdate: many(webhookGraphSchemaUpdate),
}));

export const gitInstallationTypeEnum = pgEnum('git_installation_type', ['PERSONAL', 'ORGANIZATION'] as const);

export const gitInstallations = pgTable('git_installations', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  slug: text('slug').notNull(),
  type: gitInstallationTypeEnum('type').notNull(),
  providerAccountId: bigint('provider_account_id', { mode: 'number' }).notNull(),
  providerInstallationId: bigint('provider_installation_id', { mode: 'number' }).notNull(),
  providerName: text('provider_name').notNull(),
  oauthToken: text('oauth_token'),
});

export const integrationTypeEnum = pgEnum('integration_type', ['slack'] as const);

export const organizationIntegrations = pgTable(
  'organization_integrations',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    events: text('events').array(),
    type: integrationTypeEnum('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_integration_idx').on(t.organizationId, t.name),
    };
  },
);

export const slackIntegrationConfigs = pgTable('slack_integration_configs', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  integrationId: uuid('integration_id')
    .notNull()
    .references(() => organizationIntegrations.id, {
      onDelete: 'cascade',
    }),
  endpoint: text('endpoint').notNull(),
});

export const slackSchemaUpdateEventConfigs = pgTable('slack_schema_update_event_configs', {
  slackIntegrationConfigId: uuid('slack_integration_config_id')
    .notNull()
    .references(() => slackIntegrationConfigs.id, {
      onDelete: 'cascade',
    }),
  federatedGraphId: uuid('federated_graph_id')
    .notNull()
    .references(() => federatedGraphs.id, {
      onDelete: 'cascade',
    }),
});

export const organizationIntegrationRelations = relations(organizationIntegrations, ({ one }) => ({
  organization: one(organizations),
  slackIntegrationConfigs: one(slackIntegrationConfigs),
}));

export const slackIntegrationConfigsRelations = relations(slackIntegrationConfigs, ({ many }) => ({
  slackSchemUpdateEventConfigs: many(slackSchemaUpdateEventConfigs),
}));

export const slackSchemaUpdateEventConfigRelations = relations(slackSchemaUpdateEventConfigs, ({ one }) => ({
  slackIntegrationEventConfig: one(slackIntegrationConfigs, {
    fields: [slackSchemaUpdateEventConfigs.slackIntegrationConfigId],
    references: [slackIntegrationConfigs.id],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [slackSchemaUpdateEventConfigs.federatedGraphId],
    references: [federatedGraphs.id],
  }),
}));

export const slackInstallations = pgTable(
  'slack_installations',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    slackOrganizationId: text('slack_organization_id').notNull(),
    slackOrganizationName: text('slack_organization_name').notNull(),
    slackChannelId: text('slack_channel_id').notNull(),
    slackChannelName: text('slack_channel_name').notNull(),
    slackUserId: text('slack_user_id').notNull(),
    accessToken: text('access_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('slack_installations_idx').on(t.organizationId, t.slackOrganizationId, t.slackChannelId),
    };
  },
);

export const oidcProviders = pgTable('oidc_providers', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  name: text('name').notNull(),
  alias: text('alias').notNull().unique(),
  endpoint: text('endpoint').notNull(),
});

export const graphCompositions = pgTable('graph_compositions', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  schemaVersionId: uuid('schema_version_id')
    .notNull()
    .references(() => schemaVersion.id, {
      onDelete: 'cascade',
    }),
  // Determines if the schema is valid.
  isComposable: boolean('is_composable').default(false),
  // The errors that occurred during the composition of the schema. This is only set when isComposable is false.
  compositionErrors: text('composition_errors'),
  // This is router config based on the composed schema. Only set for federated graphs.
  routerConfig: customJsonb('router_config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id, {
    onDelete: 'cascade',
  }),
});

// stores the relation between the fedGraph schema versions and its respective subgraph schema versions
export const graphCompositionSubgraphs = pgTable('graph_composition_subgraphs', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  graphCompositionId: uuid('graph_composition_id')
    .notNull()
    .references(() => graphCompositions.id, {
      onDelete: 'cascade',
    }),
  schemaVersionId: uuid('schema_version_id')
    .notNull()
    .references(() => schemaVersion.id, {
      onDelete: 'cascade',
    }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const graphCompositionsRelations = relations(graphCompositions, ({ many, one }) => ({
  graphCompositionSubgraphs: many(graphCompositionSubgraphs),
  schemaVersion: one(schemaVersion),
  user: one(users),
}));

export const apiKeyResources = pgTable('api_key_resources', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id')
    .notNull()
    .references(() => apiKeys.id, {
      onDelete: 'cascade',
    }),
  targetId: uuid('target_id').references(() => targets.id, { onDelete: 'set null' }),
});

export const subgraphMembers = pgTable(
  'subgraph_members',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subgraphId: uuid('subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      memberIndex: uniqueIndex('unique_subgraph_member_idx').on(t.userId, t.subgraphId),
    };
  },
);
