import { relations } from 'drizzle-orm';
import { boolean, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

export const subgraphs = pgTable('subgraphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  routingUrl: text('routing_url').notNull(),
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

export const targetTypeEnum = pgEnum('target_type', ['federated', 'subgraph', 'graph']);

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
  targetId: uuid('target_id').references(() => targets.id, {
    onDelete: 'cascade',
  }),
  // The actual schema definition of the graph. For GraphQL, this is the SDL.
  // For a monolithic GraphQL, it is the SDL.
  // For a federated Graph, this is the composition result.
  schemaSDL: text('schema_sdl'),
  // Determines if the composed schema is valid. This is the current state available for serving to routers.
  isComposable: boolean('is_composable').default(false),
  // The errors that occurred during the composition of the schema. This is only set when isComposable is false.
  compositionErrors: text('composition_errors'),
  // This is router config based on the composed schema. Only set for federated graphs.
  routerConfig: jsonb('router_config'),
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
]);

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
  hasBreakingChanges: boolean('has_breaking_changes').default(false),
  proposedSubgraphSchemaSDL: text('proposed_subgraph_schema_sdl'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    userId: uuid('user_id').references(() => users.id),
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

export const graphApiTokens = pgTable('graph_api_tokens', {
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
  isPersonal: boolean('is_personal').default(false),
  isFreeTrial: boolean('is_free_trial').default(false),
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
    acceptedInvite: boolean('accepted_invite').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_member_idx').on(t.id),
    };
  },
);

export const organizationRelations = relations(organizations, ({ many }) => ({
  members: many(organizationsMembers),
  graphApiTokens: many(graphApiTokens),
}));

export const memberRoleEnum = pgEnum('member_role', ['admin', 'member']);

export const organizationMemberRoles = pgTable('organization_member_roles', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationMemberId: uuid('organization_member_id')
    .notNull()
    .references(() => organizationsMembers.id, {
      onDelete: 'cascade',
    }),
  role: memberRoleEnum('role').notNull(),
});

export const organizationMembersRelations = relations(organizationsMembers, ({ many }) => ({
  memberRoles: many(organizationMemberRoles),
}));

export const organizationMemberRolesRelations = relations(organizationMemberRoles, ({ one }) => ({
  member: one(organizationsMembers, {
    fields: [organizationMemberRoles.organizationMemberId],
    references: [organizationsMembers.id],
  }),
}));

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

export const organizationWebhookRelations = relations(organizationWebhooks, ({ many }) => ({
  organization: many(organizations),
}));
