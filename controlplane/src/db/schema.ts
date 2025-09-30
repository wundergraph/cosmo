import { relations, sql } from 'drizzle-orm';
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
  index,
  json,
  real,
} from 'drizzle-orm/pg-core';
import type { JSONContent } from '@tiptap/core';
import { AxiosHeaderValue } from 'axios';
import { FeatureIds } from '../types/index.js';
import { AuditableType, AuditActorType, AuditLogAction, AuditLogFullAction } from './models.js';

export const federatedGraphs = pgTable(
  'federated_graphs', // fgs
  {
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
    /* The version that composition returns to determine whether the router execution configuration is compatible
     * with a specific router version.
     */
    routerCompatibilityVersion: text('router_compatibility_version').notNull().default('1'),
  },
  (t) => ({
    targetIdIndex: index('fgs_target_id_idx').on(t.targetId),
    composedSchemaVersionIdIndex: index('fgs_composed_schema_version_id_idx').on(t.composedSchemaVersionId),
  }),
);

export const contracts = pgTable(
  'contracts', // contracts
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
    includeTags: text('include_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    createdByIdIndex: index('contracts_created_by_id_idx').on(t.createdById),
    updatedByIdIndex: index('contracts_updated_by_id_idx').on(t.updatedById),
    downStreamFederatedGraphIdIndex: index('contracts_downstream_federated_graph_id_idx').on(
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
  'federated_graph_clients', // fgc
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
    createdByIdIndex: index('fgc_created_by_id_idx').on(t.createdById),
    updatedByIdIndex: index('fgc_updated_by_id_idx').on(t.updatedById),
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
  'federated_graph_persisted_operations', // fgpo
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
    createdByIdIndex: index('fgpo_created_by_id_idx').on(t.createdById),
    updatedByIdIndex: index('fgpo_updated_by_id_idx').on(t.updatedById),
    clientIdIndex: index('fgpo_client_id_idx').on(t.clientId),
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

export const subgraphTypeEnum = pgEnum('subgraph_type', ['standard', 'grpc_plugin', 'grpc_service'] as const);

export const subgraphs = pgTable(
  'subgraphs', // subgraphs
  {
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
    type: subgraphTypeEnum('type').notNull().default('standard'),
  },
  (t) => {
    return {
      targetIdIndex: index('subgraphs_target_id_idx').on(t.targetId),
      schemaVersionIdIndex: index('subgraphs_schema_version_id_idx').on(t.schemaVersionId),
    };
  },
);

// The link is a one way link from source to target.
// The source subgraph can be linked only to one target subgraph, thats why we have a unique constraint on the source subgraph.
export const linkedSubgraphs = pgTable(
  'linked_subgraphs', // ls
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSubgraphId: uuid('source_subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      })
      .unique(),
    targetSubgraphId: uuid('target_subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      sourceSubgraphIdIndex: index('ls_source_subgraph_id_idx').on(t.sourceSubgraphId),
      targetSubgraphIdIndex: index('ls_target_subgraph_id_idx').on(t.targetSubgraphId),
      createdByIdIndex: index('ls_created_by_id_idx').on(t.createdById),
    };
  },
);

export const featureSubgraphsToBaseSubgraphs = pgTable(
  'feature_subgraphs_to_base_subgraphs', // fsbs
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
      featureSubgraphIdIndex: index('fsbs_feature_subgraph_id_idx').on(t.featureSubgraphId),
      baseSubgraphIdIndex: index('fsbs_base_subgraph_id_idx').on(t.baseSubgraphId),
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

export const featureFlags = pgTable(
  'feature_flags', // ff
  {
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
  },
  (t) => {
    return {
      organizationIdIndex: index('ff_organization_id_idx').on(t.organizationId),
      namespaceIdIndex: index('ff_namespace_id_idx').on(t.namespaceId),
      createdByIndex: index('ff_created_by_idx').on(t.createdBy),
    };
  },
);

export const featureFlagToFeatureSubgraphs = pgTable(
  'feature_flags_to_feature_subgraphs', // fffs
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
      featureFlagIdIndex: index('fffs_feature_flag_id_idx').on(t.featureFlagId),
      featureSubgraphIdIndex: index('fffs_feature_subgraph_id_idx').on(t.featureSubgraphId),
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
  'federated_graphs_to_feature_flag_schema_versions', // fgffsv
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
      federatedGraphIdIndex: index('fgffsv_federated_graph_id_idx').on(t.federatedGraphId),
      baseCompositionSchemaVersionIdIndex: index('fgffsv_base_composition_schema_version_id_idx').on(
        t.baseCompositionSchemaVersionId,
      ),
      composedSchemaVersionIdIndex: index('fgffsv_composed_schema_version_id_idx').on(t.composedSchemaVersionId),
      featureFlagIdIndex: index('fgffsv_feature_flag_id_idx').on(t.featureFlagId),
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
  'federated_subgraphs', // fs
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
      federatedGraphIdIndex: index('fs_federated_graph_id_idx').on(t.federatedGraphId),
      subgraphIdIndex: index('fs_subgraph_id_idx').on(t.subgraphId),
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
  'namespaces', // ns
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
  },
  (t) => {
    return {
      uniqueName: unique('unique_name').on(t.name, t.organizationId),
      organizationIdIndex: index('ns_organization_id_idx').on(t.organizationId),
      createdByIndex: index('ns_created_by_idx').on(t.createdBy),
    };
  },
);

export const namespaceConfig = pgTable(
  'namespace_config',
  {
    namespaceId: uuid('namespace_id')
      .notNull()
      .references(() => namespaces.id, {
        onDelete: 'cascade',
      }),
    enableLinting: boolean('enable_linting').default(false).notNull(),
    enableGraphPruning: boolean('enable_graph_pruning').default(false).notNull(),
    enableCacheWarming: boolean('enable_cache_warming').default(false).notNull(),
    checksTimeframeInDays: integer('checks_timeframe_in_days'),
    enableProposals: boolean('enable_proposals').default(false).notNull(),
  },
  (t) => {
    return {
      uniqueNamespace: unique('unique_namespace').on(t.namespaceId),
    };
  },
);

export const namespaceConfigRelations = relations(namespaceConfig, ({ one }) => ({
  namespace: one(namespaces, {
    fields: [namespaceConfig.namespaceId],
    references: [namespaces.id],
  }),
}));

export const targetTypeEnum = pgEnum('target_type', ['federated', 'subgraph'] as const);

export const targets = pgTable(
  'targets', // targets
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
      organizationIdIndex: index('targets_organization_id_idx').on(t.organizationId),
      createdByIndex: index('targets_created_by_idx').on(t.createdBy),
      namespaceIdIndex: index('targets_namespace_id_idx').on(t.namespaceId),
    };
  },
);

export const targetLabelMatchers = pgTable(
  'target_label_matchers', // tlm
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
      targetIdIndex: index('tlm_target_id_idx').on(t.targetId),
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

export const namespacesRelations = relations(namespaces, ({ many, one }) => ({
  targets: many(targets),
  namespaceConfig: one(namespaceConfig),
}));

// Do not cascade delete on deletion of target. The registry should be untouched unless organization is deleted.
export const schemaVersion = pgTable(
  'schema_versions', // sv
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetId: uuid('target_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    // The actual schema definition of the graph. For GraphQL, this is the SDL.
    // For a monolithic GraphQL, it is the SDL.
    // For a federated Graph, this is the composition result.
    schemaSDL: text('schema_sdl'),
    clientSchema: text('client_schema'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isV2Graph: boolean('is_v2_graph'),
  },
  (t) => {
    return {
      organizationIdIndex: index('sv_organization_id_idx').on(t.organizationId),
      targetIdIndex: index('sv_target_id_idx').on(t.targetId),
    };
  },
);

// https://github.com/kamilkisiela/graphql-inspector/blob/master/packages/core/src/diff/changes/change.ts
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
  'DIRECTIVE_USAGE_UNION_MEMBER_ADDED',
  'DIRECTIVE_USAGE_UNION_MEMBER_REMOVED',
  'DIRECTIVE_USAGE_ENUM_ADDED',
  'DIRECTIVE_USAGE_ENUM_REMOVED',
  'DIRECTIVE_USAGE_ENUM_VALUE_ADDED',
  'DIRECTIVE_USAGE_ENUM_VALUE_REMOVED',
  'DIRECTIVE_USAGE_INPUT_OBJECT_ADDED',
  'DIRECTIVE_USAGE_INPUT_OBJECT_REMOVED',
  'DIRECTIVE_USAGE_FIELD_ADDED',
  'DIRECTIVE_USAGE_FIELD_REMOVED',
  'DIRECTIVE_USAGE_SCALAR_ADDED',
  'DIRECTIVE_USAGE_SCALAR_REMOVED',
  'DIRECTIVE_USAGE_OBJECT_ADDED',
  'DIRECTIVE_USAGE_OBJECT_REMOVED',
  'DIRECTIVE_USAGE_INTERFACE_ADDED',
  'DIRECTIVE_USAGE_INTERFACE_REMOVED',
  'DIRECTIVE_USAGE_ARGUMENT_DEFINITION_ADDED',
  'DIRECTIVE_USAGE_ARGUMENT_DEFINITION_REMOVED',
  'DIRECTIVE_USAGE_SCHEMA_ADDED',
  'DIRECTIVE_USAGE_SCHEMA_REMOVED',
  'DIRECTIVE_USAGE_FIELD_DEFINITION_ADDED',
  'DIRECTIVE_USAGE_FIELD_DEFINITION_REMOVED',
  'DIRECTIVE_USAGE_INPUT_FIELD_DEFINITION_ADDED',
  'DIRECTIVE_USAGE_INPUT_FIELD_DEFINITION_REMOVED',
] as const);

export const schemaVersionChangeAction = pgTable(
  'schema_version_change_action', // svca
  {
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
  },
  (t) => {
    return {
      schemaVersionIdIndex: index('svca_schema_version_id_idx').on(t.schemaVersionId),
    };
  },
);

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

export const proposalMatchEnum = pgEnum('proposal_match', ['success', 'warn', 'error'] as const);

export const schemaChecks = pgTable(
  'schema_checks', // sc
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetId: uuid('target_id').references(() => targets.id, {
      onDelete: 'cascade',
    }),
    isComposable: boolean('is_composable').default(false),
    isDeleted: boolean('is_deleted').default(false),
    hasBreakingChanges: boolean('has_breaking_changes').default(false),
    hasLintErrors: boolean('has_lint_errors').default(false),
    hasGraphPruningErrors: boolean('has_graph_pruning_errors').default(false),
    hasClientTraffic: boolean('has_client_traffic').default(false),
    proposalMatch: proposalMatchEnum('proposal_match'),
    clientTrafficCheckSkipped: boolean('client_traffic_check_skipped').default(false),
    lintSkipped: boolean('lint_skipped'),
    graphPruningSkipped: boolean('graph_pruning_skipped'),
    compositionSkipped: boolean('composition_skipped').default(false),
    breakingChangesSkipped: boolean('breaking_changes_skipped').default(false),
    proposedSubgraphSchemaSDL: text('proposed_subgraph_schema_sdl'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ghDetails: json('gh_details').$type<{
      accountId: number;
      repositorySlug: string;
      ownerSlug: string;
      checkRunId: number;
      commitSha: string;
    }>(),
    forcedSuccess: boolean('forced_success').default(false),
    vcsContext: json('vcs_context').$type<{
      author: string;
      commitSha: string;
      branch: string;
    }>(),
    // this is used to store the error message of a non check policy
    errorMessage: text('error_message'),
  },
  (t) => {
    return {
      targetIdIndex: index('sc_target_id_idx').on(t.targetId),
    };
  },
);

export const linkedSchemaChecks = pgTable(
  'linked_schema_checks', // lsc
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaCheckId: uuid('schema_check_id')
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    linkedSchemaCheckId: uuid('linked_schema_check_id')
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      })
      .notNull(),
  },
  (t) => {
    return {
      uniqueLinkedSchemaCheck: uniqueIndex('lsc_schema_check_id_linked_schema_check_id_unique').on(
        t.schemaCheckId,
        t.linkedSchemaCheckId,
      ),
      schemaCheckIdIndex: index('lsc_schema_check_id_idx').on(t.schemaCheckId),
      linkedSchemaCheckIdIndex: index('lsc_linked_schema_check_id_idx').on(t.linkedSchemaCheckId),
    };
  },
);

export const schemaCheckSubgraphs = pgTable(
  'schema_check_subgraphs', // scs
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaCheckId: uuid('schema_check_id')
      .notNull()
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      }),
    subgraphId: uuid('subgraph_id').references(() => subgraphs.id, {
      onDelete: 'set null',
    }),
    subgraphName: text('subgraph_name').notNull(),
    proposedSubgraphSchemaSDL: text('proposed_subgraph_schema_sdl'),
    isDeleted: boolean('is_deleted').default(false).notNull(),
    isNew: boolean('is_new').default(false).notNull(),
    namespaceId: uuid('namespace_id').references(() => namespaces.id, {
      onDelete: 'cascade',
    }),
    labels: text('labels').array(),
  },
  (t) => {
    return {
      schemaCheckIdIndex: index('scs_schema_check_id_idx').on(t.schemaCheckId),
      subgraphIdIndex: index('scs_subgraph_id_idx').on(t.subgraphId),
    };
  },
);

export const schemaCheckSubgraphRelations = relations(schemaCheckSubgraphs, ({ one }) => ({
  schemaCheck: one(schemaChecks, {
    fields: [schemaCheckSubgraphs.schemaCheckId],
    references: [schemaChecks.id],
  }),
  namespace: one(namespaces, {
    fields: [schemaCheckSubgraphs.namespaceId],
    references: [namespaces.id],
  }),
}));

export const schemaCheckChangeActionOperationUsage = pgTable(
  'schema_check_change_operation_usage', // sccou
  {
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
  },
  (t) => {
    return {
      schemaCheckChangeActionIdIndex: index('sccou_schema_check_change_action_id_idx').on(t.schemaCheckChangeActionId),
      federatedGraphIdIndex: index('sccou_federated_graph_id_idx').on(t.federatedGraphId),
    };
  },
);

export const schemaCheckChangeActionOperationUsageRelations = relations(
  schemaCheckChangeActionOperationUsage,
  ({ one }) => ({
    changeAction: one(schemaCheckChangeAction, {
      fields: [schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId],
      references: [schemaCheckChangeAction.id],
    }),
  }),
);

export const schemaCheckFederatedGraphs = pgTable(
  'schema_check_federated_graphs', // scfg
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
  },
  (t) => {
    return {
      checkIdIndex: index('scfg_check_id_idx').on(t.checkId),
      federatedGraphIdIndex: index('scfg_federated_graph_id_idx').on(t.federatedGraphId),
    };
  },
);

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

// a join table between schema check subgraphs and schema check fed graphs
export const schemaCheckSubgraphsFederatedGraphs = pgTable(
  'schema_check_subgraphs_federated_graphs', // scsfg
  {
    schemaCheckFederatedGraphId: uuid('schema_check_federated_graph_id').references(
      () => schemaCheckFederatedGraphs.id,
      {
        onDelete: 'cascade',
      },
    ),
    schemaCheckSubgraphId: uuid('schema_check_subgraph_id').references(() => schemaCheckSubgraphs.id, {
      onDelete: 'cascade',
    }),
  },
  (t) => {
    return {
      schemaCheckSubgraphIdIndex: index('scsfg_schema_check_subgraph_id_idx').on(t.schemaCheckSubgraphId),
      schemaCheckFederatedGraphIdIndex: index('scsfg_schema_check_federated_graph_id_idx').on(
        t.schemaCheckFederatedGraphId,
      ),
    };
  },
);

// This table is used to track the checks that are associated with a proposal
// so the checks that are run when the proposal is created, updated.
export const proposalChecks = pgTable(
  'proposal_checks', // pc
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaCheckId: uuid('schema_check_id')
      .notNull()
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, {
        // cascade as delete proposal will not be allowed
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      uniqueCheckIdProposalId: uniqueIndex('pc_check_id_proposal_id_idx').on(t.schemaCheckId, t.proposalId),
    };
  },
);

export const schemaCheckChangeAction = pgTable(
  'schema_check_change_action', // scca
  {
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
    schemaCheckSubgraphId: uuid('schema_check_subgraph_id').references(() => schemaCheckSubgraphs.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      schemaCheckIdIndex: index('scca_schema_check_id_idx').on(t.schemaCheckId),
    };
  },
);

export const schemaCheckChangeActionRelations = relations(schemaCheckChangeAction, ({ one, many }) => ({
  check: one(schemaChecks, {
    fields: [schemaCheckChangeAction.schemaCheckId],
    references: [schemaChecks.id],
  }),
  operationUsage: many(schemaCheckChangeActionOperationUsage),
  checkSubgraph: one(schemaCheckSubgraphs, {
    fields: [schemaCheckChangeAction.schemaCheckSubgraphId],
    references: [schemaCheckSubgraphs.id],
  }),
}));

export const operationChangeOverrides = pgTable(
  'operation_change_overrides', // oco
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
      createdByIndex: index('oco_created_by_idx').on(t.createdBy),
    };
  },
);

export const operationIgnoreAllOverrides = pgTable(
  'operation_ignore_all_overrides', // oiao
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
      createdByIndex: index('oiao_created_by_idx').on(t.createdBy),
    };
  },
);

export const schemaCheckComposition = pgTable(
  'schema_check_composition', // scc
  {
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
    compositionWarnings: text('composition_warnings'),
    composedSchemaSDL: text('composed_schema_sdl'),
    clientSchema: text('client_schema'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      schemaCheckIdIndex: index('scc_schema_check_id_idx').on(t.schemaCheckId),
      federatedTargetIdIndex: index('scc_target_id_idx').on(t.federatedTargetId),
    };
  },
);

export const schemaCheckRelations = relations(schemaChecks, ({ many }) => ({
  changes: many(schemaCheckChangeAction),
  compositions: many(schemaCheckComposition),
  affectedGraphs: many(schemaCheckFederatedGraphs),
  subgraphs: many(schemaCheckSubgraphs),
  federatedGraphs: many(schemaCheckFederatedGraphs),
}));

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').unique().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions', // sessions
  {
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
  },
  (t) => {
    return {
      userIdIndex: index('sessions_user_id_idx').on(t.userId),
    };
  },
);

/**
 * API keys are created globally and are used by the CLI, router and CI/CD systems
 * to make changes to all resources that the user has access to.
 */
export const apiKeys = pgTable(
  'api_keys', // ak
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
    groupId: uuid('group_id').references(() => organizationGroups.id, {
      onDelete: 'set null',
    }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('apikey_name_idx').on(t.name, t.organizationId),
      userIdIndex: index('ak_user_id_idx').on(t.userId),
      organizationIdIndex: index('ak_organization_id_idx').on(t.organizationId),
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
  'graph_api_tokens', // gat
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
    createdBy: uuid('created_by').references(() => users.id, {
      // Deleting a user should not delete the token because it is a shared resource
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('graphApiToken_name_idx').on(t.name, t.federatedGraphId),
      organizationIdIndex: index('gat_organization_id_idx').on(t.organizationId),
      federatedGraphId: index('gat_federated_graph_id_idx').on(t.federatedGraphId),
      createdByIndex: index('gat_created_by_idx').on(t.createdBy),
    };
  },
);

export const graphRequestKeys = pgTable(
  'graph_request_keys', // grk
  {
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
  },
  (t) => {
    return {
      organizationIdIndex: index('grk_organization_id_idx').on(t.organizationId),
      federatedGraphId: index('grk_federated_graph_id_idx').on(t.federatedGraphId),
    };
  },
);

export const organizations = pgTable(
  'organizations', // orgs
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    inviteCode: text('invite_code'),
    createdBy: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    kcGroupId: uuid('kc_group_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isDeactivated: boolean('is_deactivated').default(false),
    deactivationReason: text('deactivation_reason'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    queuedForDeletionAt: timestamp('queued_for_deletion_at', { withTimezone: true }),
    queuedForDeletionBy: text('queued_for_deletion_by'), // display name in case the member is removed
  },
  (t) => {
    return {
      createdByIndex: index('orgs_created_by_idx').on(t.createdBy),
    };
  },
);

export const organizationBilling = pgTable(
  'organization_billing', // orgb
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

export const organizationBillingRelations = relations(organizationBilling, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationBilling.organizationId],
    references: [organizations.id],
  }),
}));

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
  features: json('features').$type<Feature[]>().notNull(),
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
export const billingSubscriptions = pgTable(
  'billing_subscriptions', // billsubs
  {
    id: text('id').notNull().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    metadata: json('metadata').$type<{ [key: string]: string }>().notNull(),
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
  },
  (t) => {
    return {
      organizationIdIndex: index('billsubs_organization_id_idx').on(t.organizationId),
    };
  },
);

export const billingSubscriptionsRelations = relations(billingSubscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [billingSubscriptions.organizationId],
    references: [organizations.id],
  }),
}));

export const organizationsMembers = pgTable(
  'organization_members', // orgm
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
      organizationIdIndex: index('orgm_organization_id_idx').on(t.organizationId),
    };
  },
);

export const organizationRoleEnum = pgEnum('organization_role', [
  'organization-admin',
  'organization-developer',
  'organization-viewer',
  'organization-apikey-manager',
  'namespace-admin',
  'namespace-viewer',
  'graph-admin',
  'graph-viewer',
  'subgraph-admin',
  'subgraph-publisher',
  'subgraph-checker',
  'subgraph-viewer',
] as const);

export const organizationGroups = pgTable('organization_groups', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, {
      onDelete: 'cascade',
    }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  builtin: boolean('builtin').notNull(),
  kcGroupId: text('kc_group_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationGroupRules = pgTable('organization_group_rules', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => organizationGroups.id, {
      onDelete: 'cascade',
    }),
  role: organizationRoleEnum('role').notNull(),
});

export const organizationGroupRuleNamespaces = pgTable('organization_group_rule_namespaces', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => organizationGroupRules.id, { onDelete: 'cascade' }),
  namespaceId: uuid('namespace_id')
    .notNull()
    .references(() => namespaces.id, { onDelete: 'cascade' }),
});

export const organizationGroupRuleTargets = pgTable('organization_group_rule_targets', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => organizationGroupRules.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id')
    .notNull()
    .references(() => targets.id, { onDelete: 'cascade' }),
});

export const organizationGroupMembers = pgTable(
  'organization_group_members',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationMemberId: uuid('organization_member_id')
      .notNull()
      .references(() => organizationsMembers.id, {
        onDelete: 'cascade',
      }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => organizationGroups.id, {
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      nameIndex: uniqueIndex('organization_member_group_idx').on(t.organizationMemberId, t.groupId),
    };
  },
);

export const organizationRelations = relations(organizations, ({ many }) => ({
  members: many(organizationsMembers),
  graphApiTokens: many(graphApiTokens),
  auditLogs: many(auditLogs),
}));

export const organizationGroupsRelations = relations(organizationGroups, ({ many }) => ({
  rules: many(organizationGroupRules),
  members: many(organizationGroupMembers),
}));

export const organizationGroupRulesRelations = relations(organizationGroupRules, ({ one, many }) => ({
  group: one(organizationGroups, {
    fields: [organizationGroupRules.groupId],
    references: [organizationGroups.id],
  }),
  namespaces: many(organizationGroupRuleNamespaces),
  targets: many(organizationGroupRuleTargets),
}));

export const organizationGroupRuleNamespaceRelations = relations(organizationGroupRuleNamespaces, ({ one }) => ({
  rule: one(organizationGroupRules, {
    fields: [organizationGroupRuleNamespaces.ruleId],
    references: [organizationGroupRules.id],
  }),
  namespace: one(namespaces, {
    fields: [organizationGroupRuleNamespaces.namespaceId],
    references: [namespaces.id],
  }),
}));

export const organizationGroupRuleTargetRelations = relations(organizationGroupRuleTargets, ({ one }) => ({
  rule: one(organizationGroupRules, {
    fields: [organizationGroupRuleTargets.ruleId],
    references: [organizationGroupRules.id],
  }),
}));

export const organizationGroupMembersRelationships = relations(organizationGroupMembers, ({ one }) => ({
  group: one(organizationGroups, {
    fields: [organizationGroupMembers.groupId],
    references: [organizationGroups.id],
  }),
}));

export const memberRoleEnum = pgEnum('member_role', ['admin', 'developer', 'viewer'] as const);

// @deprecated
export const organizationMemberRoles = pgTable(
  'organization_member_roles', // omr
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
  'organization_features', // orgf
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
      organizationIdIndex: index('orgf_organization_id_idx').on(t.organizationId),
    };
  },
);

export const organizationInvitations = pgTable(
  'organization_invitations', // orginv
  {
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
  },
  (t) => {
    return {
      organizationIdIndex: index('orginv_organization_id_idx').on(t.organizationId),
      userIdIndex: index('orginv_user_id_idx').on(t.userId),
      invitedByIndex: index('orginv_invited_by_idx').on(t.invitedBy),
    };
  },
);

export const organizationInvitationGroups = pgTable(
  'organization_invitation_groups',
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => organizationInvitations.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => organizationGroups.id, { onDelete: 'cascade' }),
  },
  (t) => {
    return {
      invitationIdIndex: index('org_inv_invitation_idx').on(t.invitationId),
      groupIdIndex: index('org_inv_group_id').on(t.groupId),
    };
  },
);

export const organizationWebhooks = pgTable(
  'organization_webhook_configs', // orgwc
  {
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
  },
  (t) => {
    return {
      organizationIdIndex: index('orgwc_organization_id_idx').on(t.organizationId),
    };
  },
);

export const webhookGraphSchemaUpdate = pgTable(
  'webhook_graph_schema_update', // wgsu
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
      webhookIdIndex: index('wgsu_webhook_id_idx').on(t.webhookId),
      federatedGraphIdIndex: index('wgsu_federated_graph_id_idx').on(t.federatedGraphId),
    };
  },
);

export const webhookProposalStateUpdate = pgTable(
  'webhook_proposal_state_update', // wpsu
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
      webhookIdIndex: index('wpsu_webhook_id_idx').on(t.webhookId),
      federatedGraphIdIndex: index('wpsu_federated_graph_id_idx').on(t.federatedGraphId),
    };
  },
);

export const webhookDeliveryType = pgEnum('webhook_delivery_type', ['webhook', 'slack', 'admission'] as const);

export const webhookDeliveries = pgTable(
  'webhook_deliveries', // webhd
  {
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
    requestHeaders: json('request_headers').$type<Record<string, AxiosHeaderValue | undefined>>().notNull(),
    responseHeaders: json('response_headers').$type<Record<string, AxiosHeaderValue | undefined>>(),
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
  },
  (t) => {
    return {
      organizationIdIndex: index('webhd_organization_id_idx').on(t.organizationId),
      createdByIdIndex: index('webhd_created_by_id_idx').on(t.createdById),
    };
  },
);

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

export const webhookProposalStateUpdateRelations = relations(webhookProposalStateUpdate, ({ one }) => ({
  organizationWebhook: one(organizationWebhooks, {
    fields: [webhookProposalStateUpdate.webhookId],
    references: [organizationWebhooks.id],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [webhookProposalStateUpdate.federatedGraphId],
    references: [federatedGraphs.id],
  }),
}));

export const organizationWebhookRelations = relations(organizationWebhooks, ({ many }) => ({
  organization: many(organizations),
  webhookGraphSchemaUpdate: many(webhookGraphSchemaUpdate),
  webhookProposalStateUpdate: many(webhookProposalStateUpdate),
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
  'organization_integrations', // orgint
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
      organizationIdIndex: index('orgint_organization_id_idx').on(t.organizationId),
    };
  },
);

export const slackIntegrationConfigs = pgTable(
  'slack_integration_configs', // slackintconf
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => organizationIntegrations.id, {
        onDelete: 'cascade',
      }),
    endpoint: text('endpoint').notNull(),
  },
  (t) => {
    return {
      integrationIdIndex: index('slackintconf_integration_id_idx').on(t.integrationId),
    };
  },
);

export const slackSchemaUpdateEventConfigs = pgTable(
  'slack_schema_update_event_configs', // slacksuec
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
      slackIntegrationConfigIdIndex: index('slacksuec_slack_integration_config_id_idx').on(t.slackIntegrationConfigId),
      federatedGraphIdIndex: index('slacksuec_federated_graph_id_idx').on(t.federatedGraphId),
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
  'slack_installations', // slackinst
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
      organizationIdIndex: index('slackinst_organization_id_idx').on(t.organizationId),
    };
  },
);

export const oidcProviders = pgTable(
  'oidc_providers', // oidcp
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    alias: text('alias').notNull().unique(),
    endpoint: text('endpoint').notNull(),
  },
  (t) => {
    return {
      organizationIdIndex: index('oidcp_organization_id_idx').on(t.organizationId),
    };
  },
);

export const auditLogs = pgTable(
  'audit_logs', // auditlogs
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(), // we don't want the audit log to be dropped when the organization is deleted
    organizationSlug: text('organization_slug'),

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

    apiKeyName: text('api_key_name'), // the name of the api key used to perform the operation. Will only have a value when the actor type is api_key

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      organizationIdIndex: index('auditlogs_organization_idx').on(t.organizationId),
      createdAtIndex: index('auditlogs_created_at_idx').on(t.createdAt),
    };
  },
);

export const graphCompositions = pgTable(
  'graph_compositions', // graphcomp
  {
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
    compositionWarnings: text('composition_warnings'),
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
    routerCompatibilityVersion: text('router_compatibility_version').notNull().default('1'),
  },
  (t) => {
    return {
      schemaVersionIdIndex: index('graphcomp_schema_version_id_idx').on(t.schemaVersionId),
      createdByIdIndex: index('graphcomp_created_by_id_idx').on(t.createdById),
    };
  },
);

export const graphCompositionSubgraphChangeTypeEnum = pgEnum('graph_composition_subgraph_change_type', [
  'added',
  'removed',
  'updated',
  'unchanged',
] as const);

// Store some data about subgraph redundantly in case a subgraph is deleted
export const graphCompositionSubgraphs = pgTable(
  'graph_composition_subgraphs', // graphcompsub
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    graphCompositionId: uuid('graph_composition_id')
      .notNull()
      .references(() => graphCompositions.id, {
        onDelete: 'cascade',
      }),
    subgraphId: uuid('subgraph_id').notNull(),
    subgraphTargetId: uuid('subgraph_target_id').notNull(),
    subgraphName: text('subgraph_name').notNull(),
    schemaVersionId: uuid('schema_version_id')
      .notNull()
      .references(() => schemaVersion.id, {
        onDelete: 'cascade',
      }),
    changeType: graphCompositionSubgraphChangeTypeEnum('change_type').notNull().default('unchanged'),
    isFeatureSubgraph: boolean('is_feature_subgraph').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      graphCompositionIdIndex: index('graphcompsub_graph_composition_id_idx').on(t.graphCompositionId),
      schemaVersionIdIndex: index('graphcompsub_schema_version_id_idx').on(t.schemaVersionId),
    };
  },
);

export const graphCompositionsRelations = relations(graphCompositions, ({ many, one }) => ({
  graphCompositionSubgraphs: many(graphCompositionSubgraphs),
  schemaVersion: one(schemaVersion),
  user: one(users),
}));

export const apiKeyResources = pgTable(
  'api_key_resources', // akr
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, {
        onDelete: 'cascade',
      }),
    targetId: uuid('target_id').references(() => targets.id, { onDelete: 'set null' }),
  },
  (t) => {
    return {
      apiKeyIdIndex: index('akr_api_key_id_idx').on(t.apiKeyId),
      targetIdIndex: index('akr_target_id_idx').on(t.targetId),
    };
  },
);

export const apiKeyPermissions = pgTable(
  'api_key_permissions', // akp
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, {
        onDelete: 'cascade',
      }),
    permission: text('permission').notNull(),
  },
  (t) => {
    return {
      apiKeyIdIndex: index('akp_api_key_id_idx').on(t.apiKeyId),
    };
  },
);

export const subgraphMembers = pgTable(
  'subgraph_members', // sm
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
      userIdIndex: index('sm_user_id_idx').on(t.userId),
      subgraphIdIndex: index('sm_subgraph_id_idx').on(t.subgraphId),
    };
  },
);

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

export const namespaceLintCheckConfig = pgTable(
  'namespace_lint_check_config', // nslcc
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    namespaceId: uuid('namespace_id')
      .notNull()
      .references(() => namespaces.id, {
        onDelete: 'cascade',
      }),
    lintRule: lintRulesEnum('lint_rule').notNull(),
    severityLevel: lintSeverityEnum('severity_level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      namespaceIdIndex: index('nslcc_namespace_id_idx').on(t.namespaceId),
    };
  },
);

export const namespaceLintCheckConfigRelations = relations(namespaceLintCheckConfig, ({ one }) => ({
  namespace: one(namespaces),
}));

export const graphPruningRulesEnum = pgEnum('graph_pruning_rules', [
  'UNUSED_FIELDS',
  'DEPRECATED_FIELDS',
  'REQUIRE_DEPRECATION_BEFORE_DELETION',
] as const);

export const namespaceGraphPruningCheckConfig = pgTable(
  'namespace_graph_pruning_check_config', // nsgpcc
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    namespaceId: uuid('namespace_id')
      .notNull()
      .references(() => namespaces.id, {
        onDelete: 'cascade',
      }),
    graphPruningRule: graphPruningRulesEnum('graph_pruning_rule').notNull(),
    severityLevel: lintSeverityEnum('severity_level').notNull(),
    gracePeriod: integer('grace_period').notNull(),
    schemaUsageCheckPeriod: integer('scheme_usage_check_period'), // in days
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      namespaceIdIndex: index('nsgpcc_namespace_id_idx').on(t.namespaceId),
    };
  },
);

export const namespaceGraphPruningCheckConfigRelations = relations(namespaceGraphPruningCheckConfig, ({ one }) => ({
  namespace: one(namespaces, {
    fields: [namespaceGraphPruningCheckConfig.namespaceId],
    references: [namespaces.id],
  }),
}));

export const namespaceProposalConfig = pgTable(
  'namespace_proposal_config', // npc
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    namespaceId: uuid('namespace_id')
      .notNull()
      .references(() => namespaces.id, {
        onDelete: 'cascade',
      }),
    checkSeverityLevel: lintSeverityEnum('check_severity_level').notNull(),
    publishSeverityLevel: lintSeverityEnum('publish_severity_level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => {
    return {
      uniqueNamespace: unique('npc_namespace_id_idx').on(t.namespaceId),
    };
  },
);

export const namespaceProposalConfigRelations = relations(namespaceProposalConfig, ({ one }) => ({
  namespace: one(namespaces, {
    fields: [namespaceProposalConfig.namespaceId],
    references: [namespaces.id],
  }),
}));

export const schemaCheckLintAction = pgTable(
  'schema_check_lint_action', // sclact
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaCheckId: uuid('schema_check_id')
      .notNull()
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      }),
    lintRuleType: lintRulesEnum('lint_rule_type'),
    message: text('message'),
    isError: boolean('is_error').default(false),
    location: json('location')
      .$type<{ line: number; column: number; endLine?: number; endColumn?: number }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    schemaCheckSubgraphId: uuid('schema_check_subgraph_id').references(() => schemaCheckSubgraphs.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      schemaCheckIdIndex: index('sclact_schema_check_id_idx').on(t.schemaCheckId),
    };
  },
);

export const schemaCheckLintActionRelations = relations(schemaCheckLintAction, ({ one }) => ({
  check: one(schemaChecks, {
    fields: [schemaCheckLintAction.schemaCheckId],
    references: [schemaChecks.id],
  }),
  checkSubgraph: one(schemaCheckSubgraphs, {
    fields: [schemaCheckLintAction.schemaCheckSubgraphId],
    references: [schemaCheckSubgraphs.id],
  }),
}));

export const schemaCheckGraphPruningAction = pgTable(
  'schema_check_graph_pruning_action', // scgpa
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaCheckId: uuid('schema_check_id')
      .notNull()
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      }),
    graphPruningRuleType: graphPruningRulesEnum('graph_pruning_rule').notNull(),
    fieldPath: text('field_path').notNull(),
    message: text('message'),
    isError: boolean('is_error').default(false),
    location: json('location')
      .$type<{ line: number; column: number; endLine?: number; endColumn?: number }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    schemaCheckSubgraphId: uuid('schema_check_subgraph_id').references(() => schemaCheckSubgraphs.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      schemaCheckIdIndex: index('scgpa_schema_check_id_idx').on(t.schemaCheckId),
      federatedGraphIdIndex: index('scgpa_federated_graph_id_idx').on(t.federatedGraphId),
    };
  },
);

export const schemaCheckGraphPruningActionRelations = relations(schemaCheckGraphPruningAction, ({ one }) => ({
  check: one(schemaChecks, {
    fields: [schemaCheckGraphPruningAction.schemaCheckId],
    references: [schemaChecks.id],
  }),
  federatedGraph: one(federatedGraphs, {
    fields: [schemaCheckGraphPruningAction.federatedGraphId],
    references: [federatedGraphs.id],
  }),
  checkSubgraph: one(schemaCheckSubgraphs, {
    fields: [schemaCheckGraphPruningAction.schemaCheckSubgraphId],
    references: [schemaCheckSubgraphs.id],
  }),
}));

export const fieldGracePeriod = pgTable(
  'field_grace_period', // fgp
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subgraphId: uuid('subgraph_id')
      .notNull()
      .references(() => subgraphs.id, {
        onDelete: 'cascade',
      }),
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
    path: text('path'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    isDeprecated: boolean('is_deprecated'),
  },
  (t) => {
    return {
      fieldGracePeriodIndex: uniqueIndex('unique_field_grace_period_idx').on(
        t.subgraphId,
        t.namespaceId,
        t.organizationId,
        t.path,
        t.isDeprecated,
      ),
      subgraphIdIndex: index('fgp_subgraph_id_idx').on(t.subgraphId),
      organizationIdIndex: index('fgp_organization_id_idx').on(t.organizationId),
      namespaceIdIndex: index('fgp_namespace_id_idx').on(t.namespaceId),
    };
  },
);

export const fieldGracePeriodRelations = relations(fieldGracePeriod, ({ one }) => ({
  subgraph: one(subgraphs, {
    fields: [fieldGracePeriod.subgraphId],
    references: [subgraphs.id],
  }),
  namespace: one(namespaces, {
    fields: [fieldGracePeriod.namespaceId],
    references: [namespaces.id],
  }),
  organization: one(organizations, {
    fields: [fieldGracePeriod.organizationId],
    references: [organizations.id],
  }),
}));

export const playgroundScriptTypeEnum = pgEnum('playground_script_type', [
  'pre-flight',
  'pre-operation',
  'post-operation',
] as const);

export const playgroundScripts = pgTable(
  'playground_scripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, {
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull().default(''),
    type: playgroundScriptTypeEnum('type').notNull(),
    content: text('content').notNull().default(''),
  },
  (t) => {
    return {
      organizationIdIndex: index('ps_organization_id_idx').on(t.organizationId),
      createdByIdIndex: index('ps_created_by_id_idx').on(t.createdById),
    };
  },
);

export const cacheWarmerOperations = pgTable(
  'cache_warmer_operations', // cwo
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, { onDelete: 'cascade' }),
    operationContent: text('operation_content'),
    operationHash: text('operation_hash'),
    operationPersistedID: text('operation_persisted_id'),
    operationName: text('operation_name'),
    clientName: text('client_name'),
    clientVersion: text('client_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    planningTime: real('planning_time'),
    // is true if the operation is added by the user
    isManuallyAdded: boolean('is_manually_added').default(false).notNull(),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => {
    return {
      organizationIdIndex: index('cwo_organization_id_idx').on(t.organizationId),
      federatedGraphId: index('cwo_federated_graph_id_idx').on(t.federatedGraphId),
      createdByIdIndex: index('cwo_created_by_id_idx').on(t.createdById),
    };
  },
);

export const namespaceCacheWarmerConfig = pgTable(
  'namespace_cache_warmer_config', // nscwc
  {
    id: uuid('id').notNull().primaryKey().defaultRandom(),
    namespaceId: uuid('namespace_id')
      .notNull()
      .unique()
      .references(() => namespaces.id, {
        onDelete: 'cascade',
      }),
    maxOperationsCount: integer('max_operations_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => {
    return {
      namespaceIdIndex: index('nscwc_namespace_id_idx').on(t.namespaceId),
    };
  },
);

export const namespaceCacheWarmerConfigRelations = relations(namespaceCacheWarmerConfig, ({ one }) => ({
  namespace: one(namespaces),
}));

export const proposalStateEnum = pgEnum('proposal_state', ['DRAFT', 'APPROVED', 'PUBLISHED', 'CLOSED'] as const);

export const proposals = pgTable(
  'proposals', // pr
  {
    id: uuid('id').primaryKey().defaultRandom(),
    federatedGraphId: uuid('federated_graph_id')
      .notNull()
      .references(() => federatedGraphs.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    state: proposalStateEnum('state').notNull(),
  },
  (t) => ({
    uniqueFederatedGraphClientName: unique('federated_graph_proposal_name').on(t.federatedGraphId, t.name),
    createdByIdIndex: index('pr_created_by_id_idx').on(t.createdById),
    federatedGraphIdIndex: index('pr_federated_graph_id_idx').on(t.federatedGraphId),
  }),
);

export const proposalRelations = relations(proposals, ({ one }) => ({
  federatedGraph: one(federatedGraphs, {
    fields: [proposals.federatedGraphId],
    references: [federatedGraphs.id],
  }),
}));

export const proposalSubgraphs = pgTable(
  'proposal_subgraphs', // prs
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    subgraphId: uuid('subgraph_id').references(() => subgraphs.id, {
      onDelete: 'set null',
    }),
    subgraphName: text('subgraph_name').notNull(),
    schemaSDL: text('schema_sdl'),
    isDeleted: boolean('is_deleted').default(false).notNull(),
    isNew: boolean('is_new').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    isPublished: boolean('is_published').default(false).notNull(),
    // This is the schema version that is currently being used by the subgraph when the proposal was created
    currentSchemaVersionId: uuid('current_schema_version_id').references(() => schemaVersion.id, {
      onDelete: 'set null',
    }),
    labels: text('labels').array(),
  },
  (t) => ({
    uniqueProposalSubgraph: unique('proposal_subgraph').on(t.proposalId, t.subgraphName),
  }),
);

export const proposalSubgraphsRelations = relations(proposalSubgraphs, ({ one }) => ({
  proposal: one(proposals, { fields: [proposalSubgraphs.proposalId], references: [proposals.id] }),
  subgraph: one(subgraphs, { fields: [proposalSubgraphs.subgraphId], references: [subgraphs.id] }),
}));

export const schemaCheckProposalMatch = pgTable(
  'schema_check_proposal_match', // scpm
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaCheckId: uuid('schema_check_id')
      .notNull()
      .references(() => schemaChecks.id, {
        onDelete: 'cascade',
      }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, {
        onDelete: 'cascade',
      }),
    proposalMatch: boolean('proposal_match').notNull(),
  },
  (t) => {
    return {
      schemaCheckIdIndex: index('scpm_schema_check_id_idx').on(t.schemaCheckId),
      proposalIdIndex: index('scpm_proposal_id_idx').on(t.proposalId),
      uniqueSchemaCheckProposalMatch: unique('unique_schema_check_proposal_match').on(t.schemaCheckId, t.proposalId),
    };
  },
);

export const schemaCheckProposalMatchRelations = relations(schemaCheckProposalMatch, ({ one }) => ({
  check: one(schemaChecks, {
    fields: [schemaCheckProposalMatch.schemaCheckId],
    references: [schemaChecks.id],
  }),
  proposal: one(proposals, {
    fields: [schemaCheckProposalMatch.proposalId],
    references: [proposals.id],
  }),
}));

export const protobufSchemaVersions = pgTable('protobuf_schema_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaVersionId: uuid('schema_version_id')
    .notNull()
    .references(() => schemaVersion.id, { onDelete: 'cascade' }),
  protoSchema: text('proto_schema').notNull(),
  protoMappings: text('proto_mappings').notNull(),
  protoLock: text('proto_lock').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const protobufSchemaVersionsRelations = relations(protobufSchemaVersions, ({ one }) => ({
  schemaVersion: one(schemaVersion, {
    fields: [protobufSchemaVersions.schemaVersionId],
    references: [schemaVersion.id],
  }),
}));

export const pluginImageVersions = pgTable('plugin_image_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  schemaVersionId: uuid('schema_version_id')
    .notNull()
    .references(() => schemaVersion.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  platform: text('platform').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pluginImageVersionsRelations = relations(pluginImageVersions, ({ one }) => ({
  schemaVersion: one(schemaVersion, {
    fields: [pluginImageVersions.schemaVersionId],
    references: [schemaVersion.id],
  }),
}));
