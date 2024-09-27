import { ServiceImpl } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import type { RouterOptions } from '../routes.js';
import { getAnalyticsView } from './analytics/getAnalyticsView.js';
import { getDashboardAnalyticsView } from './analytics/getDashboardAnalyticsView.js';
import { getFieldUsage } from './analytics/getFieldUsage.js';
import { getGraphMetrics } from './analytics/getGraphMetrics.js';
import { getMetricsErrorRate } from './analytics/getMetricsErrorRate.js';
import { getOperationContent } from './analytics/getOperationContent.js';
import { getOrganizationRequestsCount } from './analytics/getOrganizationRequestsCount.js';
import { getSubgraphMetrics } from './analytics/getSubgraphMetrics.js';
import { getSubgraphMetricsErrorRate } from './analytics/getSubgraphMetricsErrorRate.js';
import { getTrace } from './analytics/getTrace.js';
import { createAPIKey } from './api-key/createAPIKey.js';
import { deleteAPIKey } from './api-key/deleteAPIKey.js';
import { getAPIKeys } from './api-key/getAPIKeys.js';
import { createBillingPortalSession } from './billing/createBillingPortalSession.js';
import { createCheckoutSession } from './billing/createCheckoutSession.js';
import { getBillingPlans } from './billing/getBillingPlans.js';
import { upgradePlan } from './billing/upgradePlan.js';
import { createIgnoreOverridesForAllOperations } from './check/createIgnoreOverridesForAllOperations.js';
import { createOperationIgnoreAllOverride } from './check/createOperationIgnoreAllOverride.js';
import { createOperationOverrides } from './check/createOperationOverrides.js';
import { forceCheckSuccess } from './check/forceCheckSuccess.js';
import { getAllOverrides } from './check/getAllOverrides.js';
import { getCheckOperations } from './check/getCheckOperations.js';
import { getCheckSummary } from './check/getCheckSummary.js';
import { getChecksByFederatedGraphName } from './check/getChecksByFederatedGraphName.js';
import { getOperationOverrides } from './check/getOperationOverrides.js';
import { removeOperationIgnoreAllOverride } from './check/removeOperationIgnoreAllOverride.js';
import { removeOperationOverrides } from './check/removeOperationOverrides.js';
import { toggleChangeOverridesForAllOperations } from './check/toggleChangeOverridesForAllOperations.js';
import { createContract } from './contract/createContract.js';
import { updateContract } from './contract/updateContract.js';
import { createDiscussion } from './discussion/createDiscussion.js';
import { deleteDiscussionComment } from './discussion/deleteDiscussionComment.js';
import { getAllDiscussions } from './discussion/getAllDiscussions.js';
import { getDiscussion } from './discussion/getDiscussion.js';
import { getDiscussionSchemas } from './discussion/getDiscussionSchemas.js';
import { replyToDiscussion } from './discussion/replyToDiscussion.js';
import { setDiscussionResolution } from './discussion/setDiscussionResolution.js';
import { updateDiscussionComment } from './discussion/updateDiscussionComment.js';
import { getChangelogBySchemaVersion } from './schema-version/getChangelogBySchemaVersion.js';
import { getSdlBySchemaVersion } from './schema-version/getSdlBySchemaVersion.js';
import { isGitHubAppInstalled } from './check/isGitHubAppInstalled.js';
import { migrateFromApollo } from './federated-graph/migrateFromApollo.js';
import { createFeatureFlag } from './feature-flag/createFeatureFlag.js';
import { deleteFeatureFlag } from './feature-flag/deleteFeatureFlag.js';
import { enableFeatureFlag } from './feature-flag/enableFeatureFlag.js';
import { getFeatureFlagByName } from './feature-flag/getFeatureFlagByName.js';
import { getFeatureFlags } from './feature-flag/getFeatureFlags.js';
import { getFeatureFlagsByFederatedGraph } from './feature-flag/getFeatureFlagsByFederatedGraph.js';
import { getFeatureSubgraphs } from './feature-flag/getFeatureSubgraphs.js';
import { getFeatureSubgraphsByFeatureFlag } from './feature-flag/getFeatureSubgraphsByFeatureFlag.js';
import { updateFeatureFlag } from './feature-flag/updateFeatureFlag.js';
import { checkFederatedGraph } from './federated-graph/checkFederatedGraph.js';
import { createFederatedGraph } from './federated-graph/createFederatedGraph.js';
import { createFederatedGraphToken } from './federated-graph/createFederatedGraphToken.js';
import { deleteFederatedGraph } from './federated-graph/deleteFederatedGraph.js';
import { deleteRouterToken } from './federated-graph/deleteRouterToken.js';
import { generateRouterToken } from './federated-graph/generateRouterToken.js';
import { getCompositionDetails } from './federated-graph/getCompositionDetails.js';
import { getCompositions } from './federated-graph/getCompositions.js';
import { getFederatedGraphByName } from './federated-graph/getFederatedGraphByName.js';
import { getFederatedGraphChangelog } from './federated-graph/getFederatedGraphChangelog.js';
import { getFederatedGraphSDLByName } from './federated-graph/getFederatedGraphSDLByName.js';
import { getFederatedGraphs } from './federated-graph/getFederatedGraphs.js';
import { getFederatedGraphsBySubgraphLabels } from './federated-graph/getFederatedGraphsBySubgraphLabels.js';
import { getRouterTokens } from './federated-graph/getRouterTokens.js';
import { getRouters } from './federated-graph/getRouters.js';
import { moveFederatedGraph } from './federated-graph/moveFederatedGraph.js';
import { updateFederatedGraph } from './federated-graph/updateFederatedGraph.js';
import { configureNamespaceGraphPruningConfig } from './linting/configureNamespaceGraphPruningConfig.js';
import { configureNamespaceLintConfig } from './linting/configureNamespaceLintConfig.js';
import { enableGraphPruning } from './linting/enableGraphPruning.js';
import { enableLintingForTheNamespace } from './linting/enableLintingForTheNamespace.js';
import { getNamespaceGraphPruningConfig } from './linting/getNamespaceGraphPruningConfig.js';
import { getNamespaceLintConfig } from './linting/getNamespaceLintConfig.js';
import { createMonograph } from './monograph/createMonograph.js';
import { deleteMonograph } from './monograph/deleteMonograph.js';
import { migrateMonograph } from './monograph/migrateMonograph.js';
import { moveMonograph } from './monograph/moveMonograph.js';
import { publishMonograph } from './monograph/publishMonograph.js';
import { updateMonograph } from './monograph/updateMonograph.js';
import { createNamespace } from './namespace/createNamespace.js';
import { deleteNamespace } from './namespace/deleteNamespace.js';
import { getNamespaces } from './namespace/getNamespaces.js';
import { renameNamespace } from './namespace/renameNamespace.js';
import { createIntegration } from './notification/createIntegration.js';
import { createOrganizationWebhookConfig } from './notification/createOrganizationWebhookConfig.js';
import { deleteIntegration } from './notification/deleteIntegration.js';
import { deleteOrganizationWebhookConfig } from './notification/deleteOrganizationWebhookConfig.js';
import { getOrganizationIntegrations } from './notification/getOrganizationIntegrations.js';
import { getOrganizationWebhookConfigs } from './notification/getOrganizationWebhookConfigs.js';
import { getOrganizationWebhookHistory } from './notification/getOrganizationWebhookHistory.js';
import { getOrganizationWebhookMeta } from './notification/getOrganizationWebhookMeta.js';
import { getWebhookDeliveryDetails } from './notification/getWebhookDeliveryDetails.js';
import { redeliverWebhook } from './notification/redeliverWebhook.js';
import { updateIntegrationConfig } from './notification/updateIntegrationConfig.js';
import { updateOrganizationWebhookConfig } from './notification/updateOrganizationWebhookConfig.js';
import { createOrganization } from './organization/createOrganization.js';
import { deleteOrganization } from './organization/deleteOrganization.js';
import { getAuditLogs } from './organization/getAuditLogs.js';
import { getOrganizationMembers } from './organization/getOrganizationMembers.js';
import { getPendingOrganizationMembers } from './organization/getPendingOrganizationMembers.js';
import { isMemberLimitReached } from './organization/isMemberLimitReached.js';
import { leaveOrganization } from './organization/leaveOrganization.js';
import { updateFeatureSettings } from './organization/updateFeatureSettings.js';
import { updateOrganizationDetails } from './organization/updateOrganizationDetails.js';
import { whoAmI } from './organization/whoAmI.js';
import { getClients } from './persisted-operation/getClients.js';
import { getPersistedOperations } from './persisted-operation/getPersistedOperations.js';
import { publishPersistedOperations } from './persisted-operation/publishPersistedOperations.js';
import { createOIDCProvider } from './sso/createOIDCProvider.js';
import { deleteOIDCProvider } from './sso/deleteOIDCProvider.js';
import { getOIDCProvider } from './sso/getOIDCProvider.js';
import { addReadme } from './subgraph/addReadme.js';
import { addSubgraphMember } from './subgraph/addSubgraphMember.js';
import { checkSubgraphSchema } from './subgraph/checkSubgraphSchema.js';
import { createFederatedSubgraph } from './subgraph/createFederatedSubgraph.js';
import { deleteFederatedSubgraph } from './subgraph/deleteFederatedSubgraph.js';
import { fixSubgraphSchema } from './subgraph/fixSubgraphSchema.js';
import { getLatestSubgraphSDL } from './subgraph/getLatestSubgraphSDL.js';
import { getSubgraphByName } from './subgraph/getSubgraphByName.js';
import { getSubgraphMembers } from './subgraph/getSubgraphMembers.js';
import { getSubgraphSDLFromLatestComposition } from './subgraph/getSubgraphSDLFromLatestComposition.js';
import { getSubgraphs } from './subgraph/getSubgraphs.js';
import { moveSubgraph } from './subgraph/moveSubgraph.js';
import { publishFederatedSubgraph } from './subgraph/publishFederatedSubgraph.js';
import { removeSubgraphMember } from './subgraph/removeSubgraphMember.js';
import { updateSubgraph } from './subgraph/updateSubgraph.js';
import { acceptOrDeclineInvitation } from './user/acceptOrDeclineInvitation.js';
import { deleteUser } from './user/deleteUser.js';
import { getInvitations } from './user/getInvitations.js';
import { getUserAccessiblePermissions } from './user/getUserAccessiblePermissions.js';
import { getUserAccessibleResources } from './user/getUserAccessibleResources.js';
import { inviteUser } from './user/inviteUser.js';
import { removeInvitation } from './user/removeInvitation.js';
import { removeOrganizationMember } from './user/removeOrganizationMember.js';
import { updateOrgMemberRole } from './user/updateOrgMemberRole.js';
import { updateIDPMappers } from './sso/updateIDPMappers.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof PlatformService>> {
  return {
    /*
    Mutations
    */

    createNamespace: (req, ctx) => {
      return createNamespace(opts, req, ctx);
    },

    deleteNamespace: (req, ctx) => {
      return deleteNamespace(opts, req, ctx);
    },

    renameNamespace: (req, ctx) => {
      return renameNamespace(opts, req, ctx);
    },

    getNamespaces: (req, ctx) => {
      return getNamespaces(opts, req, ctx);
    },

    moveMonograph: (req, ctx) => {
      return moveMonograph(opts, req, ctx);
    },

    migrateMonograph: (req, ctx) => {
      return migrateMonograph(opts, req, ctx);
    },

    moveFederatedGraph: (req, ctx) => {
      return moveFederatedGraph(opts, req, ctx);
    },

    moveSubgraph: (req, ctx) => {
      return moveSubgraph(opts, req, ctx);
    },

    createMonograph: (req, ctx) => {
      return createMonograph(opts, req, ctx);
    },

    createFederatedGraph: (req, ctx) => {
      return createFederatedGraph(opts, req, ctx);
    },

    createContract: (req, ctx) => {
      return createContract(opts, req, ctx);
    },

    updateContract: (req, ctx) => {
      return updateContract(opts, req, ctx);
    },

    createFederatedSubgraph: (req, ctx) => {
      return createFederatedSubgraph(opts, req, ctx);
    },

    checkSubgraphSchema: (req, ctx) => {
      return checkSubgraphSchema(opts, req, ctx);
    },

    fixSubgraphSchema: (req, ctx) => {
      return fixSubgraphSchema(opts, req, ctx);
    },

    publishMonograph: (req, ctx) => {
      return publishMonograph(opts, req, ctx);
    },

    publishFederatedSubgraph: (req, ctx) => {
      return publishFederatedSubgraph(opts, req, ctx);
    },

    forceCheckSuccess: (req, ctx) => {
      return forceCheckSuccess(opts, req, ctx);
    },

    createOperationOverrides: (req, ctx) => {
      return createOperationOverrides(opts, req, ctx);
    },

    removeOperationOverrides: (req, ctx) => {
      return removeOperationOverrides(opts, req, ctx);
    },

    removeOperationIgnoreAllOverride: (req, ctx) => {
      return removeOperationIgnoreAllOverride(opts, req, ctx);
    },

    createIgnoreOverridesForAllOperations: (req, ctx) => {
      return createIgnoreOverridesForAllOperations(opts, req, ctx);
    },

    toggleChangeOverridesForAllOperations: (req, ctx) => {
      return toggleChangeOverridesForAllOperations(opts, req, ctx);
    },

    createOperationIgnoreAllOverride: (req, ctx) => {
      return createOperationIgnoreAllOverride(opts, req, ctx);
    },

    getOperationOverrides: (req, ctx) => {
      return getOperationOverrides(opts, req, ctx);
    },

    getAllOverrides: (req, ctx) => {
      return getAllOverrides(opts, req, ctx);
    },

    deleteMonograph: (req, ctx) => {
      return deleteMonograph(opts, req, ctx);
    },

    deleteFederatedGraph: (req, ctx) => {
      return deleteFederatedGraph(opts, req, ctx);
    },

    deleteFederatedSubgraph: (req, ctx) => {
      return deleteFederatedSubgraph(opts, req, ctx);
    },

    createFeatureFlag: (req, ctx) => {
      return createFeatureFlag(opts, req, ctx);
    },

    updateFeatureFlag: (req, ctx) => {
      return updateFeatureFlag(opts, req, ctx);
    },

    enableFeatureFlag: (req, ctx) => {
      return enableFeatureFlag(opts, req, ctx);
    },

    deleteFeatureFlag: (req, ctx) => {
      return deleteFeatureFlag(opts, req, ctx);
    },

    updateMonograph: (req, ctx) => {
      return updateMonograph(opts, req, ctx);
    },

    updateFederatedGraph: (req, ctx) => {
      return updateFederatedGraph(opts, req, ctx);
    },

    updateSubgraph: (req, ctx) => {
      return updateSubgraph(opts, req, ctx);
    },

    checkFederatedGraph: (req, ctx) => {
      return checkFederatedGraph(opts, req, ctx);
    },

    createFederatedGraphToken: (req, ctx) => {
      return createFederatedGraphToken(opts, req, ctx);
    },

    inviteUser: (req, ctx) => {
      return inviteUser(opts, req, ctx);
    },

    createAPIKey: (req, ctx) => {
      return createAPIKey(opts, req, ctx);
    },

    deleteAPIKey: (req, ctx) => {
      return deleteAPIKey(opts, req, ctx);
    },

    removeOrganizationMember: (req, ctx) => {
      return removeOrganizationMember(opts, req, ctx);
    },

    removeInvitation: (req, ctx) => {
      return removeInvitation(opts, req, ctx);
    },

    migrateFromApollo: (req, ctx) => {
      return migrateFromApollo(opts, req, ctx);
    },

    createOrganizationWebhookConfig: (req, ctx) => {
      return createOrganizationWebhookConfig(opts, req, ctx);
    },

    updateOrganizationWebhookConfig: (req, ctx) => {
      return updateOrganizationWebhookConfig(opts, req, ctx);
    },

    deleteOrganizationWebhookConfig: (req, ctx) => {
      return deleteOrganizationWebhookConfig(opts, req, ctx);
    },

    deleteOrganization: (req, ctx) => {
      return deleteOrganization(opts, req, ctx);
    },

    leaveOrganization: (req, ctx) => {
      return leaveOrganization(opts, req, ctx);
    },

    updateOrganizationDetails: (req, ctx) => {
      return updateOrganizationDetails(opts, req, ctx);
    },

    updateOrgMemberRole: (req, ctx) => {
      return updateOrgMemberRole(opts, req, ctx);
    },

    deleteRouterToken: (req, ctx) => {
      return deleteRouterToken(opts, req, ctx);
    },

    createIntegration: (req, ctx) => {
      return createIntegration(opts, req, ctx);
    },

    updateIntegrationConfig: (req, ctx) => {
      return updateIntegrationConfig(opts, req, ctx);
    },

    deleteIntegration: (req, ctx) => {
      return deleteIntegration(opts, req, ctx);
    },

    createOIDCProvider: (req, ctx) => {
      return createOIDCProvider(opts, req, ctx);
    },

    deleteOIDCProvider: (req, ctx) => {
      return deleteOIDCProvider(opts, req, ctx);
    },

    publishPersistedOperations: (req, ctx) => {
      return publishPersistedOperations(opts, req, ctx);
    },

    acceptOrDeclineInvitation: (req, ctx) => {
      return acceptOrDeclineInvitation(opts, req, ctx);
    },

    updateFeatureSettings: (req, ctx) => {
      return updateFeatureSettings(opts, req, ctx);
    },

    addSubgraphMember: (req, ctx) => {
      return addSubgraphMember(opts, req, ctx);
    },

    removeSubgraphMember: (req, ctx) => {
      return removeSubgraphMember(opts, req, ctx);
    },

    addReadme: (req, ctx) => {
      return addReadme(opts, req, ctx);
    },

    enableLintingForTheNamespace: (req, ctx) => {
      return enableLintingForTheNamespace(opts, req, ctx);
    },

    configureNamespaceLintConfig: (req, ctx) => {
      return configureNamespaceLintConfig(opts, req, ctx);
    },

    enableGraphPruning: (req, ctx) => {
      return enableGraphPruning(opts, req, ctx);
    },

    configureNamespaceGraphPruningConfig: (req, ctx) => {
      return configureNamespaceGraphPruningConfig(opts, req, ctx);
    },

    /*
    Queries
    */
    getSubgraphs: (req, ctx) => {
      return getSubgraphs(opts, req, ctx);
    },

    getFeatureSubgraphs: (req, ctx) => {
      return getFeatureSubgraphs(opts, req, ctx);
    },

    getSubgraphByName: (req, ctx) => {
      return getSubgraphByName(opts, req, ctx);
    },

    getFederatedGraphs: (req, ctx) => {
      return getFederatedGraphs(opts, req, ctx);
    },

    getFederatedGraphsBySubgraphLabels: (req, ctx) => {
      return getFederatedGraphsBySubgraphLabels(opts, req, ctx);
    },

    getFederatedGraphSDLByName: (req, ctx) => {
      return getFederatedGraphSDLByName(opts, req, ctx);
    },

    getSubgraphSDLFromLatestComposition: (req, ctx) => {
      return getSubgraphSDLFromLatestComposition(opts, req, ctx);
    },

    getLatestSubgraphSDL: (req, ctx) => {
      return getLatestSubgraphSDL(opts, req, ctx);
    },

    getFederatedGraphByName: (req, ctx) => {
      return getFederatedGraphByName(opts, req, ctx);
    },

    getFederatedGraphChangelog: (req, ctx) => {
      return getFederatedGraphChangelog(opts, req, ctx);
    },

    getChecksByFederatedGraphName: (req, ctx) => {
      return getChecksByFederatedGraphName(opts, req, ctx);
    },

    getCheckSummary: (req, ctx) => {
      return getCheckSummary(opts, req, ctx);
    },

    getCheckOperations: (req, ctx) => {
      return getCheckOperations(opts, req, ctx);
    },

    getAnalyticsView: (req, ctx) => {
      return getAnalyticsView(opts, req, ctx);
    },

    getDashboardAnalyticsView: (req, ctx) => {
      return getDashboardAnalyticsView(opts, req, ctx);
    },

    getGraphMetrics: (req, ctx) => {
      return getGraphMetrics(opts, req, ctx);
    },

    getMetricsErrorRate: (req, ctx) => {
      return getMetricsErrorRate(opts, req, ctx);
    },

    getTrace: (req, ctx) => {
      return getTrace(opts, req, ctx);
    },

    isMemberLimitReached: (req, ctx) => {
      return isMemberLimitReached(opts, req, ctx);
    },

    getOrganizationMembers: (req, ctx) => {
      return getOrganizationMembers(opts, req, ctx);
    },

    getPendingOrganizationMembers: (req, ctx) => {
      return getPendingOrganizationMembers(opts, req, ctx);
    },

    getAPIKeys: (req, ctx) => {
      return getAPIKeys(opts, req, ctx);
    },

    whoAmI: (req, ctx) => {
      return whoAmI(opts, req, ctx);
    },

    getOrganizationWebhookConfigs: (req, ctx) => {
      return getOrganizationWebhookConfigs(opts, req, ctx);
    },

    getOrganizationWebhookMeta: (req, ctx) => {
      return getOrganizationWebhookMeta(opts, req, ctx);
    },

    // generates a temporary router token to fetch the router config only. Should only be used while fetching router config.
    generateRouterToken: (req, ctx) => {
      return generateRouterToken(opts, req, ctx);
    },

    getRouterTokens: (req, ctx) => {
      return getRouterTokens(opts, req, ctx);
    },

    getOrganizationIntegrations: (req, ctx) => {
      return getOrganizationIntegrations(opts, req, ctx);
    },

    isGitHubAppInstalled: (req, ctx) => {
      return isGitHubAppInstalled(opts, req, ctx);
    },

    getFieldUsage: (req, ctx) => {
      return getFieldUsage(opts, req, ctx);
    },

    getOperationContent: (req, ctx) => {
      return getOperationContent(opts, req, ctx);
    },

    getOIDCProvider: (req, ctx) => {
      return getOIDCProvider(opts, req, ctx);
    },

    getPersistedOperations: (req, ctx) => {
      return getPersistedOperations(opts, req, ctx);
    },

    getRouters: (req, ctx) => {
      return getRouters(opts, req, ctx);
    },

    getClients: (req, ctx) => {
      return getClients(opts, req, ctx);
    },

    getOrganizationRequestsCount: (req, ctx) => {
      return getOrganizationRequestsCount(opts, req, ctx);
    },

    // returns the pending invites of a user
    getInvitations: (req, ctx) => {
      return getInvitations(opts, req, ctx);
    },

    getCompositions: (req, ctx) => {
      return getCompositions(opts, req, ctx);
    },

    getCompositionDetails: (req, ctx) => {
      return getCompositionDetails(opts, req, ctx);
    },

    getSdlBySchemaVersion: (req, ctx) => {
      return getSdlBySchemaVersion(opts, req, ctx);
    },

    getChangelogBySchemaVersion: (req, ctx) => {
      return getChangelogBySchemaVersion(opts, req, ctx);
    },

    getUserAccessibleResources: (req, ctx) => {
      return getUserAccessibleResources(opts, req, ctx);
    },

    getSubgraphMembers: (req, ctx) => {
      return getSubgraphMembers(opts, req, ctx);
    },

    getBillingPlans: (req, ctx) => {
      return getBillingPlans(opts, req, ctx);
    },

    getAuditLogs: (req, ctx) => {
      return getAuditLogs(opts, req, ctx);
    },

    createOrganization: (req, ctx) => {
      return createOrganization(opts, req, ctx);
    },

    createCheckoutSession: (req, ctx) => {
      return createCheckoutSession(opts, req, ctx);
    },

    upgradePlan: (req, ctx) => {
      return upgradePlan(opts, req, ctx);
    },

    createBillingPortalSession: (req, ctx) => {
      return createBillingPortalSession(opts, req, ctx);
    },

    createDiscussion: (req, ctx) => {
      return createDiscussion(opts, req, ctx);
    },

    replyToDiscussion: (req, ctx) => {
      return replyToDiscussion(opts, req, ctx);
    },

    getAllDiscussions: (req, ctx) => {
      return getAllDiscussions(opts, req, ctx);
    },

    updateDiscussionComment: (req, ctx) => {
      return updateDiscussionComment(opts, req, ctx);
    },

    deleteDiscussionComment: (req, ctx) => {
      return deleteDiscussionComment(opts, req, ctx);
    },

    getDiscussion: (req, ctx) => {
      return getDiscussion(opts, req, ctx);
    },

    getDiscussionSchemas: (req, ctx) => {
      return getDiscussionSchemas(opts, req, ctx);
    },

    setDiscussionResolution: (req, ctx) => {
      return setDiscussionResolution(opts, req, ctx);
    },

    getSubgraphMetrics: (req, ctx) => {
      return getSubgraphMetrics(opts, req, ctx);
    },

    getSubgraphMetricsErrorRate: (req, ctx) => {
      return getSubgraphMetricsErrorRate(opts, req, ctx);
    },

    getNamespaceLintConfig: (req, ctx) => {
      return getNamespaceLintConfig(opts, req, ctx);
    },

    getNamespaceGraphPruningConfig: (req, ctx) => {
      return getNamespaceGraphPruningConfig(opts, req, ctx);
    },

    getUserAccessiblePermissions: (req, ctx) => {
      return getUserAccessiblePermissions(opts, req, ctx);
    },

    getFeatureFlags: (req, ctx) => {
      return getFeatureFlags(opts, req, ctx);
    },

    getFeatureFlagByName: (req, ctx) => {
      return getFeatureFlagByName(opts, req, ctx);
    },

    getFeatureSubgraphsByFeatureFlag: (req, ctx) => {
      return getFeatureSubgraphsByFeatureFlag(opts, req, ctx);
    },

    deleteUser: (req, ctx) => {
      return deleteUser(opts, req, ctx);
    },

    getFeatureFlagsByFederatedGraph: (req, ctx) => {
      return getFeatureFlagsByFederatedGraph(opts, req, ctx);
    },

    getOrganizationWebhookHistory: (req, ctx) => {
      return getOrganizationWebhookHistory(opts, req, ctx);
    },

    getWebhookDeliveryDetails: (req, ctx) => {
      return getWebhookDeliveryDetails(opts, req, ctx);
    },

    redeliverWebhook: (req, ctx) => {
      return redeliverWebhook(opts, req, ctx);
    },

    updateIDPMappers: (req, ctx) => {
      return updateIDPMappers(opts, req, ctx);
    },
  };
}
