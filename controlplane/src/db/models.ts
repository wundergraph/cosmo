import {
  federatedGraphs,
  memberRoleEnum,
  organizationFeatures,
  schemaCheckChangeAction,
  schemaCheckChangeActionOperationUsage,
  subgraphs,
  targets,
} from './schema.js';

export type FederatedGraph = typeof federatedGraphs.$inferSelect;
export type Subgraph = typeof subgraphs.$inferSelect;
export type Target = typeof targets.$inferSelect;
export type SchemaCheckChangeAction = typeof schemaCheckChangeAction.$inferSelect;
export type NewSchemaChangeOperationUsage = typeof schemaCheckChangeActionOperationUsage.$inferInsert;
export type NewOrganizationFeature = typeof organizationFeatures.$inferInsert;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
