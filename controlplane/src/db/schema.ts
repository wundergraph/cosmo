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
import type { JSONContent } from '@tiptap/core';
import { AxiosHeaderValue } from 'axios';
import { FeatureIds } from '../types/index.js';
import { AuditableType, AuditActorType, AuditLogAction, AuditLogFullAction } from './models.js';

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
  // This is the latest composed schema of the federated graph. Only set for a static composition of subgraphs.
  composedSchemaVersionId: uuid('composed_schema_version_id').references(() => schemaVersion.id, {
    onDelete: 'no action',
  }),
  // The admission webhook url. This is the url that the controlplane will use to run admission checks.
  // You can use this to enforce policies on the router config.
  admissionWebhookURL: text('admission_webhook_url'),
  admissionWebhookSecret: text('admission_webhook_secret'),
  supportsFederation: boolean('supports_federation').default(true).notNull(),
});

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceFederatedGraphId: uuid('source_federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    downstreamFederatedGraphId: uuid('downstream_federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    excludeTags: text('exclude_tags').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedById: uuid('updated_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    uniqueFederatedGraphSourceDownstreamGraphId: unique('federated_graph_source_downstream_id').on(
      t.sourceFederatedGraphId,
      t.downstreamFederatedGraphId,
    ),
  }),
);

export const contractsRelations = relations(contracts, ({ one }) => ({
  createdBy: one(users, {
    fields: [contracts.createdById],
    references: [users.id],
  }),
  updatedBy: one(users, {
    fields: [contracts.updatedById],
    references: [users.id],
  }),
  sourceFederatedGraph: one(federatedGraphs, {
    fields: [contracts.sourceFederatedGraphId],
    references: [federatedGraphs.id],
    relationName: 'source',
  }),
  downstreamFederatedGraph: one(federatedGraphs, {
    fields: [contracts.downstreamFederatedGraphId],
    references: [federatedGraphs.id],
    relationName: 'downstream',
  }),
}));

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
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedById: uuid('updated_by_id').references(() => users.id, {
      onDelete: 'set null',
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
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedById: uuid('updated_by_id').references(() => users.id, {
      onDelete: 'set null',
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
export const websocketSubprotocolEnum = pgEnum('websocket_subprotocol', [
  'auto',
  'graphql-ws',
  'graphql-transport-ws',
] as const);

export const subgraphs = pgTable('subgraphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  routingUrl: text('routing_url').notNull(),
  subscriptionUrl: text('subscription_url'),
  subscriptionProtocol: subscriptionProtocolEnum('subscription_protocol').notNull().default('ws'),
  websocketSubprotocol: websocketSubprotocolEnum('websocket_subprotocol').notNull().default('auto'),
  // This is the latest valid schema of the subgraph.
  schemaVersionId: uuid('schema_version_id').references(() => schemaVersion.id, {
    onDelete: 'no action',
  }),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, {
      onDelete: 'cascade',
    }),
  isFeatureSubgraph: boolean('is_feature_subgraph').notNull().default(false),
  isEventDrivenGraph: boolean('is_event_driven_graph').notNull().default(false),
});

export const featureSubgraphsToBaseSubgraphs = pgTable(
  'feature_subgraphs_to_base_subgraphs',
  {
    featureSubgraphId: uuid('feature_subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
    baseSubgraphId: uuid('base_subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
  },
  (t) => {
    return {
      pk: primaryKey({ columns: [t.featureSubgraphId, t.baseSubgraphId] }),
    };
  },
);

export const featureSubgraphsToSubgraphRelations = relations(featureSubgraphsToBaseSubgraphs, ({ one }) => ({
  baseSubgraph: one(subgraphs, {
    fields: [featureSubgraphsToBaseSubgraphs.baseSubgraphId],
    references: [subgraphs.id],
  }),
  featureSubgraph: one(subgraphs, {
    fields: [featureSubgraphsToBaseSubgraphs.featureSubgraphId],
    references: [subgraphs.id],
  }),
}));

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  namespaceId: uuid('namespace_id')
    .notNull()
    .references(() => namespaces.id, {
      onDelete: 'cascade',
    }),
  labels: text('labels').array(),
  isEnabled: boolean('is_enabled').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, {
    onDelete: 'set null',
  }),
});

export const featureFlagToFeatureSubgraphs = pgTable(
  'feature_flags_to_feature_subgraphs',
  {
    featureFlagId: uuid('feature_flag_id')
      .notNull()
      .references(() => featureFlags.id, {
        onDelete: 'cascade',
      }),
    featureSubgraphId: uuid('feature_subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
  },
  (t) => {
    return {
      pk: primaryKey({ columns: [t.featureFlagId, t.featureSubgraphId] }),
    };
  },
);

export const featureFlagToFeatureSubgraphsRelations = relations(featureFlagToFeatureSubgraphs, ({ one }) => ({
  featureFlag: one(featureFlags, {
    fields: [featureFlagToFeatureSubgraphs.featureFlagId],
    references: [featureFlags.id],
  }),
  featureSubgraph: one(subgraphs, {
    fields: [featureFlagToFeatureSubgraphs.featureSubgraphId],
    references: [subgraphs.id],
  }),
}));

export const federatedGraphsToFeatureFlagSchemaVersions = pgTable(
  'federated_graphs_to_feature_flag_schema_versions',
  {
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    baseCompositionSchemaVersionId: uuid('base_composition_schema_version_id')
      .notNull()
      .references(() => schemaVersion.id, {
        onDelete: 'cascade',
      }),
    composedSchemaVersionId: uuid('composed_schema_version_id')
      .notNull()
      .references(() => schemaVersion.id, {
        onDelete: 'cascade',
      }),
    featureFlagId: uuid('feature_flag_id').references(() => featureFlags.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      pk: primaryKey({ columns: [t.federatedGraphId, t.baseCompositionSchemaVersionId, t.composedSchemaVersionId] }),
    };
  },
);

export const federatedGraphsToFeatureFlagSchemaVersionsRelations = relations(
  federatedGraphsToFeatureFlagSchemaVersions,
  ({ one }) => ({
    federatedGraph: one(federatedGraphs, {
      fields: [federatedGraphsToFeatureFlagSchemaVersions.federatedGraphId],
      references: [federatedGraphs.id],
    }),
    schemaVersion: one(schemaVersion, {
      fields: [federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId],
      references: [schemaVersion.id],
    }),
    baseSchemaVersion: one(schemaVersion, {
      fields: [federatedGraphsToFeatureFlagSchemaVersions.baseCompositionSchemaVersionId],
      references: [schemaVersion.id],
    }),
  }),
);

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
  contract: one(contracts, {
    fields: [federatedGraphs.id],
    references: [contracts.downstreamFederatedGraphId],
    relationName: 'downstream',
  }),
  contracts: many(contracts, { relationName: 'source' }),
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
      pk: primaryKey({ columns: [t.federatedGraphId, t.subgraphId] }),
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

export const namespaces = pgTable(
  'namespaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    enableLinting: boolean('enable_linting').default(false).notNull(),
  },
  (t) => {
    return {
      uniqueName: unique('unique_name').on(t.name, t.organizationId),
    };
  },
);

export const targetTypeEnum = pgEnum('target_type', ['federated', 'subgraph'] as const);

export const targets = pgTable(
  'targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: targetTypeEnum('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    labels: text('labels').array(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    readme: text('readme'),
    namespaceId: uuid('namespace_id')
      .notNull()
      .references(() => namespaces.id, {
        onDelete: 'cascade',
      }),
  },
  (t) => {
    return {
      // A target is unique by its name, type and namespace
      // That implies that a user can create a subgraph and a federated graph with the same name in the same namespace
      nameIndex: uniqueIndex('organization_name_idx').on(t.organizationId, t.type, t.name, t.namespaceId),
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
  namespace: one(namespaces, {
    fields: [targets.namespaceId],
    references: [namespaces.id],
  }),
}));

export const namespacesRelations = relations(namespaces, ({ many }) => ({
  targets: many(targets),
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
  clientSchema: text('client_schema'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isV2Graph: boolean('is_v2_graph'),
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

export const schemaVersionRelations = relations(schemaVersion, ({ many, one }) => ({
  changes: many(schemaVersionChangeAction),
  composition: one(graphCompositions, {
    fields: [schemaVersion.id],
    references: [graphCompositions.schemaVersionId],
  }),
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
  hasLintErrors: boolean('has_lint_errors').default(false),
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
  federatedGraphId: uuid('federated_graph_id').references(() => federatedGraphs.id, {
    onDelete: 'cascade',
  }),
  isSafeOverride: boolean('is_safe_override').default(false),
});

export const schemaCheckChangeActionOperationUsageRelations = relations(
  schemaCheckChangeActionOperationUsage,
  ({ one }) => ({
    changeAction: one(schemaCheckChangeAction, {
      fields: [schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId],
      references: [schemaCheckChangeAction.id],
    }),
  }),
);

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

export const schemaCheckChangeActionRelations = relations(schemaCheckChangeAction, ({ one, many }) => ({
  check: one(schemaChecks, {
    fields: [schemaCheckChangeAction.schemaCheckId],
    references: [schemaChecks.id],
  }),
  operationUsage: many(schemaCheckChangeActionOperationUsage),
}));

export const operationChangeOverrides = pgTable(
  'operation_change_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hash: text('hash').notNull(),
    name: text('name').notNull(),
    namespaceId: text('namespace_id').notNull(),
    changeType: schemaChangeTypeEnum('change_type').notNull(),
    path: text('path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      hashIndex: uniqueIndex('hash_change_idx').on(t.hash, t.namespaceId, t.changeType, t.path),
    };
  },
);

export const operationIgnoreAllOverrides = pgTable(
  'operation_ignore_all_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hash: text('hash').notNull(),
    name: text('name').notNull(),
    namespaceId: text('namespace_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      hashIndex: uniqueIndex('hash_namespace_ignore_idx').on(t.hash, t.namespaceId),
    };
  },
);

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
  clientSchema: text('client_schema'),
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
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
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
      .references(() => users.id, {
        onDelete: 'cascade',
      }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
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
      .references(() => organizations.id, { onDelete: 'cascade' }),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').unique().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, {
      // Deleting a user should not delete the token because it is a shared resource
      onDelete: 'set null',
    }),
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
    .references(() => organizations.id, { onDelete: 'cascade' }),
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
  createdBy: uuid('user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isDeactivated: boolean('is_deactivated').default(false),
  deactivationReason: text('deactivation_reason'),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
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
  id: FeatureIds;
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
  auditLogs: many(auditLogs),
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
      pk: primaryKey({ columns: [t.webhookId, t.federatedGraphId] }),
    };
  },
);

export const webhookDeliveryType = pgEnum('webhook_delivery_type', ['webhook', 'slack', 'admission'] as const);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdById: uuid('created_by_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  type: webhookDeliveryType('type').notNull(),
  endpoint: text('endpoint').notNull(),
  eventName: text('event_name').notNull(),
  payload: text('payload').notNull(),
  requestHeaders: customJson<Record<string, AxiosHeaderValue | undefined>>('request_headers').notNull(),
  responseHeaders: customJson<Record<string, AxiosHeaderValue | undefined>>('response_headers'),
  responseStatusCode: integer('response_status_code'),
  responseErrorCode: text('response_error_code'),
  errorMessage: text('error_message'),
  responseBody: text('response_body'),
  retryCount: integer('retry_count').notNull().default(0),
  duration: real('duration').notNull().default(0),
  /***
   * Set if it is a redelivery
   * Keep track of the original id in case of redelivery.
   * The id of an already redelivered webhook may also be set here.
   *
   * Example: original > redelivery of original >  redelivery of redelivery
   */
  originalDeliveryId: text('original_delivery_id'),
});

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  user: one(users, {
    fields: [webhookDeliveries.createdById],
    references: [users.id],
  }),
}));

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

export const slackSchemaUpdateEventConfigs = pgTable(
  'slack_schema_update_event_configs',
  {
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
  },
  (t) => {
    return {
      pk: primaryKey({ columns: [t.slackIntegrationConfigId, t.federatedGraphId] }),
    };
  },
);

export const organizationIntegrationRelations = relations(organizationIntegrations, ({ one }) => ({
  organization: one(organizations),
  slackIntegrationConfigs: one(slackIntegrationConfigs),
}));

export const slackIntegrationConfigsRelations = relations(slackIntegrationConfigs, ({ many }) => ({
  slackSchemaUpdateEventConfigs: many(slackSchemaUpdateEventConfigs),
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

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),

  // Information about the action
  action: text('action').$type<AuditLogAction>().notNull(), // e.g. created
  auditAction: text('audit_action').$type<AuditLogFullAction>().notNull(), // e.g. organization.created
  auditableType: text('auditable_type').$type<AuditableType>(), // e.g. organization, the resource that was acted upon
  auditableDisplayName: text('auditable_display_name'), // e.g. name of the resource e.g. organization name to display in UI

  // Information about the target of the action
  targetId: uuid('target_id'), // e.g. id of the organization when a federated graph is created
  targetType: text('target_type'), // the type of the target e.g. organization
  targetDisplayName: text('target_display_name'), // human-readable name of the target e.g. organization name

  // Namespace information
  targetNamespaceId: text('target_namespace_id'), // The id of the namespace in which the action is performed
  targetNamespaceDisplayName: text('target_namespace'), // The name of the namespace in which the action is performed

  actorId: uuid('actor_id'), // e.g. id of the user. Can be null if the actor is a system or api_key
  actorDisplayName: text('actor_display_name'), // human-readable name of the actor e.g. user name, email
  actorType: text('actor_type').$type<AuditActorType>(), // user, system, api_key

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  // Signature of the schema. Provided by the user when the admission hook is called.
  routerConfigSignature: text('router_config_signature'),
  // The errors that occurred during the deployment of the schema. Only set when the schema was composable and no admission errors occurred.
  deploymentError: text('deployment_error'),
  // The errors that occurred during the admission of the config. Only set when the schema was composable.
  admissionError: text('admission_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdById: uuid('created_by_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdByEmail: text('created_by_email'),
  isFeatureFlagComposition: boolean('is_feature_flag_composition').default(false).notNull(),
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

export const apiKeyPermissions = pgTable('api_key_permissions', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id')
    .notNull()
    .references(() => apiKeys.id, {
      onDelete: 'cascade',
    }),
  permission: text('permission').notNull(),
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

export const discussions = pgTable('discussions', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  targetId: uuid('target_id')
    .references(() => targets.id, {
      onDelete: 'cascade',
    })
    .notNull(),
  schemaVersionId: uuid('schema_version_id')
    .notNull()
    .references(() => schemaVersion.id, {
      onDelete: 'cascade',
    }),
  referenceLine: integer('reference_line').notNull(),
  isResolved: boolean('is_resolved').default(false).notNull(),
});

export const discussionThread = pgTable('discussion_thread', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  discussionId: uuid('discussion_id')
    .notNull()
    .references(() => discussions.id, {
      onDelete: 'cascade',
    }),
  contentMarkdown: text('content_markdown'),
  contentJson: customJson<JSONContent>('content_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdById: uuid('created_by_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  isDeleted: boolean('is_deleted').default(false).notNull(),
});

export const discussionRelations = relations(discussions, ({ one, many }) => ({
  target: one(targets, {
    fields: [discussions.targetId],
    references: [targets.id],
  }),
  schemaVersion: one(schemaVersion),
  thread: many(discussionThread),
}));

export const discussionThreadRelations = relations(discussionThread, ({ one }) => ({
  createdBy: one(users, {
    fields: [discussionThread.createdById],
    references: [users.id],
  }),
  discussion: one(discussions, {
    fields: [discussionThread.discussionId],
    references: [discussions.id],
  }),
}));

export const lintRulesEnum = pgEnum('lint_rules', [
  'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
  'TYPE_NAMES_SHOULD_BE_PASCAL_CASE',
  'SHOULD_NOT_HAVE_TYPE_PREFIX',
  'SHOULD_NOT_HAVE_TYPE_SUFFIX',
  'SHOULD_NOT_HAVE_INPUT_PREFIX',
  'SHOULD_HAVE_INPUT_SUFFIX',
  'SHOULD_NOT_HAVE_ENUM_PREFIX',
  'SHOULD_NOT_HAVE_ENUM_SUFFIX',
  'SHOULD_NOT_HAVE_INTERFACE_PREFIX',
  'SHOULD_NOT_HAVE_INTERFACE_SUFFIX',
  'ENUM_VALUES_SHOULD_BE_UPPER_CASE',
  'ORDER_FIELDS',
  'ORDER_ENUM_VALUES',
  'ORDER_DEFINITIONS',
  'ALL_TYPES_REQUIRE_DESCRIPTION',
  'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES',
  'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS',
  'REQUIRE_DEPRECATION_REASON',
  // https://github.com/drizzle-team/drizzle-kit-mirror/issues/178 , the below rule is removed and not be used
  // due to a limitation in postgres, we cant remove a enum value
  // 'REQUIRE_DEPRECATION_DATE', // @deprecated
] as const);

export const lintSeverityEnum = pgEnum('lint_severity', ['warn', 'error'] as const);

export const namespaceLintCheckConfig = pgTable('namespace_lint_check_config', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  namespaceId: uuid('namespace_id')
    .notNull()
    .references(() => namespaces.id, {
      onDelete: 'cascade',
    }),
  lintRule: lintRulesEnum('lint_rule').notNull(),
  severityLevel: lintSeverityEnum('severity_level').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const namespaceLintCheckConfigRelations = relations(namespaceLintCheckConfig, ({ one }) => ({
  namespace: one(namespaces),
}));

export const schemaCheckLintAction = pgTable('schema_check_lint_action', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaCheckId: uuid('schema_check_id')
    .notNull()
    .references(() => schemaChecks.id, {
      onDelete: 'cascade',
    }),
  lintRuleType: lintRulesEnum('lint_rule_type'),
  message: text('message'),
  isError: boolean('is_error').default(false),
  location: customJson<{ line: number; column: number; endLine?: number; endColumn?: number }>('location').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schemaCheckLintActionRelations = relations(schemaCheckLintAction, ({ one }) => ({
  check: one(schemaChecks, {
    fields: [schemaCheckLintAction.schemaCheckId],
    references: [schemaChecks.id],
  }),
}));
