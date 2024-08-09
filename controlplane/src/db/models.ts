import {
  billingPlans,
  billingSubscriptions,
  federatedGraphs,
  lintRulesEnum,
  memberRoleEnum,
  organizationFeatures,
  schemaCheckChangeAction,
  schemaCheckChangeActionOperationUsage,
  subgraphs,
  targets,
  websocketSubprotocolEnum,
  webhookDeliveries,
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
export type LintRuleEnum = (typeof lintRulesEnum.enumValues)[number];
export type WebsocketSubprotocol = (typeof websocketSubprotocolEnum.enumValues)[number];

export type WebhookDeliveryInfo = typeof webhookDeliveries.$inferInsert;

export type AuditableType =
  | 'organization'
  | 'subgraph'
  | 'federated_graph'
  | 'monograph'
  | 'feature_subgraph'
  | 'feature_flag'
  | 'graph_token'
  | 'api_key'
  | 'webhook_config'
  | 'integration'
  | 'member_role'
  | 'user'
  | 'subscription'
  | 'namespace'
  | 'router_config'
  | 'operation_change_override'
  | 'operation_ignore_all_override';

export type AuditTargetType = 'organization' | 'subgraph' | 'federated_graph' | 'monograph' | 'user';

export type AuditActorType = 'user' | 'system' | 'api_key';

export type AuditLogAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'moved'
  | 'accepted'
  | 'declined'
  | 'joined'
  | 'canceled'
  | 'activated'
  | 'upgraded'
  | 'left'
  | 'fetched';

export type AuditLogFullAction =
  | 'namespace.created'
  | 'namespace.deleted'
  | 'organization.created'
  | 'organization.updated'
  | 'graph_token.created'
  | 'graph_token.deleted'
  | 'monograph.created'
  | 'monograph.updated'
  | 'monograph.deleted'
  | 'monograph.moved'
  | 'federated_graph.created'
  | 'federated_graph.deleted'
  | 'federated_graph.updated'
  | 'federated_graph.moved'
  | 'subgraph.created'
  | 'subgraph.deleted'
  | 'subgraph.updated'
  | 'subgraph.moved'
  | 'feature_flag.created'
  | 'feature_flag.deleted'
  | 'feature_flag.disabled'
  | 'feature_flag.enabled'
  | 'feature_subgraph.created'
  | 'feature_subgraph.deleted'
  | 'feature_subgraph.published'
  | 'feature_subgraph.updated'
  | 'feature_flag.updated'
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
  | 'organization.left'
  | 'organization_invitation.declined'
  | 'organization_member.deleted'
  | 'member_role.updated'
  | 'router_config.fetched'
  | 'operation_change_override.created'
  | 'operation_change_override.deleted'
  | 'operation_ignore_override.created'
  | 'operation_ignore_override.deleted';
