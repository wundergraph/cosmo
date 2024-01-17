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

export type AuditableType =
  | 'organization'
  | 'subgraph'
  | 'federated_graph'
  | 'graph_token'
  | 'api_key'
  | 'webhook_config'
  | 'integration'
  | 'subscription';

export type AuditTargetType = 'organization' | 'subgraph' | 'federated_graph';

export type AuditActorType = 'user' | 'system' | 'api_key';

export type AuditLogAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'removed'
  | 'accepted'
  | 'declined'
  | 'joined'
  | 'canceled'
  | 'activated'
  | 'upgraded'
  | 'left';

export type AuditLogFullAction =
  | 'organization.created'
  | 'organization.updated'
  | 'graph_token.created'
  | 'graph_token.deleted'
  | 'federated_graph.created'
  | 'federated_graph.deleted'
  | 'federated_graph.updated'
  | 'subgraph.created'
  | 'subgraph.deleted'
  | 'subgraph.updated'
  | 'subgraph_member.created'
  | 'subgraph_member.deleted'
  | 'webhook_config.created'
  | 'webhook_config.deleted'
  | 'webhook_config.updated'
  | 'organization_details.updated'
  | 'integration.created'
  | 'integration.deleted'
  | 'integration.updated'
  | 'api_key.created'
  | 'api_key.deleted'
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.deleted'
  | 'subscription.canceled'
  | 'subscription.upgraded'
  | 'organization_invitation.created'
  | 'organization_invitation.deleted'
  | 'organization.joined'
  | 'organization_invitation.declined'
  | 'organization_member.removed'
  | 'organization_member.left'
  | 'member_role.updated';
