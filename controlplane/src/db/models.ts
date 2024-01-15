import {
  billingPlans,
  billingSubscriptions,
  federatedGraphs,
  memberRoleEnum,
  organizationFeatures,
  schemaCheckChangeAction,
  schemaCheckChangeActionOperationUsage,
  subgraphs,
  targets,
  auditAction,
  auditableType,
  auditActorType,
  auditFullAction,
  auditTargetType,
} from './schema.js';

export type FederatedGraph = typeof federatedGraphs.$inferSelect;
export type Subgraph = typeof subgraphs.$inferSelect;
export type Target = typeof targets.$inferSelect;
export type SchemaCheckChangeAction = typeof schemaCheckChangeAction.$inferSelect;
export type NewSchemaChangeOperationUsage = typeof schemaCheckChangeActionOperationUsage.$inferInsert;
export type NewOrganizationFeature = typeof organizationFeatures.$inferInsert;
export type NewBillingSubscription = typeof billingSubscriptions.$inferInsert;
export type NewBillingPlan = typeof billingPlans.$inferInsert;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type AuditLogFullAction = (typeof auditFullAction.enumValues)[number];
export type AuditLogAction = (typeof auditAction.enumValues)[number];
export type AuditableType = (typeof auditableType.enumValues)[number];
export type AuditActorType = (typeof auditActorType.enumValues)[number];
export type AuditTargetType = (typeof auditTargetType.enumValues)[number];
