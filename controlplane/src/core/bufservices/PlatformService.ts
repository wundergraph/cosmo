import crypto from 'node:crypto';
import { PlainMessage } from '@bufbuild/protobuf';
import { ServiceImpl } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetConfigResponse } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { OrganizationEventName, PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import {
  AcceptOrDeclineInvitationResponse,
  AddReadmeResponse,
  AddSubgraphMemberResponse,
  AuditLog,
  Feature,
  CheckFederatedGraphResponse,
  CheckSubgraphSchemaResponse,
  CompositionError,
  ConfigureNamespaceLintConfigResponse,
  CreateAPIKeyResponse,
  CreateBillingPortalSessionResponse,
  CreateCheckoutSessionResponse,
  CreateDiscussionResponse,
  CreateFederatedGraphResponse,
  CreateFederatedGraphTokenResponse,
  CreateFederatedSubgraphResponse,
  CreateIntegrationResponse,
  CreateMonographResponse,
  CreateNamespaceResponse,
  CreateOIDCProviderResponse,
  CreateOperationIgnoreAllOverrideResponse,
  CreateOperationOverridesResponse,
  CreateOrganizationResponse,
  CreateOrganizationWebhookConfigResponse,
  DateRange as DateRangeProto,
  DeleteAPIKeyResponse,
  DeleteDiscussionCommentResponse,
  DeleteFederatedGraphResponse,
  DeleteFederatedSubgraphResponse,
  DeleteIntegrationResponse,
  DeleteMonographResponse,
  DeleteNamespaceResponse,
  DeleteOIDCProviderResponse,
  DeleteOrganizationResponse,
  DeleteRouterTokenResponse,
  DeploymentError,
  EnableLintingForTheNamespaceResponse,
  FixSubgraphSchemaResponse,
  ForceCheckSuccessResponse,
  GenerateRouterTokenResponse,
  GetAPIKeysResponse,
  GetAllDiscussionsResponse,
  GetAllOverridesResponse,
  GetAnalyticsViewResponse,
  GetAuditLogsResponse,
  GetBillingPlansResponse,
  GetChangelogBySchemaVersionResponse,
  GetCheckOperationsResponse,
  GetCheckSummaryResponse,
  GetChecksByFederatedGraphNameResponse,
  GetClientsResponse,
  GetCompositionDetailsResponse,
  GetCompositionsResponse,
  GetDashboardAnalyticsViewResponse,
  GetDiscussionResponse,
  GetDiscussionSchemasResponse,
  GetFederatedGraphByNameResponse,
  GetFederatedGraphChangelogResponse,
  GetFederatedGraphSDLByNameResponse,
  GetFederatedGraphsBySubgraphLabelsResponse,
  GetFederatedGraphsResponse,
  GetFieldUsageResponse,
  GetGraphMetricsResponse,
  GetInvitationsResponse,
  GetLatestSubgraphSDLResponse,
  GetMetricsErrorRateResponse,
  GetNamespaceLintConfigResponse,
  GetNamespacesResponse,
  GetOIDCProviderResponse,
  GetOperationContentResponse,
  GetOperationOverridesResponse,
  GetOrganizationIntegrationsResponse,
  GetOrganizationMembersResponse,
  GetOrganizationRequestsCountResponse,
  GetOrganizationWebhookConfigsResponse,
  GetOrganizationWebhookMetaResponse,
  GetPersistedOperationsResponse,
  GetRouterTokensResponse,
  GetRoutersResponse,
  GetSdlBySchemaVersionResponse,
  GetSubgraphByNameResponse,
  GetSubgraphMembersResponse,
  GetSubgraphMetricsErrorRateResponse,
  GetSubgraphMetricsResponse,
  GetSubgraphSDLFromLatestCompositionResponse,
  GetSubgraphsResponse,
  GetTraceResponse,
  GetUserAccessibleResourcesResponse,
  InviteUserResponse,
  IsGitHubAppInstalledResponse,
  LeaveOrganizationResponse,
  LintConfig,
  LintSeverity,
  MigrateFromApolloResponse,
  MigrateMonographResponse,
  MoveGraphResponse,
  PublishFederatedSubgraphResponse,
  PublishMonographResponse,
  PublishPersistedOperationsResponse,
  PublishedOperation,
  PublishedOperationStatus,
  RemoveInvitationResponse,
  RemoveOperationIgnoreAllOverrideResponse,
  RemoveOperationOverridesResponse,
  RemoveSubgraphMemberResponse,
  RenameNamespaceResponse,
  ReplyToDiscussionResponse,
  RequestSeriesItem,
  Router,
  SetDiscussionResolutionResponse,
  UpdateDiscussionCommentResponse,
  UpdateFeatureSettingsResponse,
  UpdateFederatedGraphResponse,
  UpdateIntegrationConfigResponse,
  UpdateMonographResponse,
  UpdateOrgMemberRoleResponse,
  UpdateOrganizationDetailsResponse,
  UpdateOrganizationWebhookConfigResponse,
  UpdateSubgraphResponse,
  UpgradePlanResponse,
  WhoAmIResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValidUrl, joinLabel } from '@wundergraph/cosmo-shared';
import { subHours } from 'date-fns';
import { FastifyBaseLogger } from 'fastify';
import { DocumentNode, buildASTSchema, parse } from 'graphql';
import { validate } from 'graphql/validation/index.js';
import { uid } from 'uid/secure';
import {
  DateRange,
  FeatureIds,
  FederatedGraphDTO,
  GraphApiKeyJwtPayload,
  GraphCompositionDTO,
  PublishedOperationData,
  SchemaLintIssues,
  SubgraphDTO,
  UpdatedPersistedOperation,
} from '../../types/index.js';
import { Composer, RouterConfigUploadError } from '../composition/composer.js';
import { buildSchema, composeSubgraphs } from '../composition/composition.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';
import { schemaLintCheck } from '../composition/schemaLint.js';
import { audiences, nowInSeconds, signJwtHS256 } from '../crypto/jwt.js';
import { PublicError } from '../errors/errors.js';
import { OpenAIGraphql } from '../openai-graphql/index.js';
import { ApiKeyRepository } from '../repositories/ApiKeyRepository.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';
import { BillingRepository } from '../repositories/BillingRepository.js';
import { DiscussionRepository } from '../repositories/DiscussionRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { GitHubRepository } from '../repositories/GitHubRepository.js';
import { GraphCompositionRepository } from '../repositories/GraphCompositionRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../repositories/NamespaceRepository.js';
import { OidcRepository } from '../repositories/OidcRepository.js';
import { OperationsRepository } from '../repositories/OperationsRepository.js';
import { OrganizationInvitationRepository } from '../repositories/OrganizationInvitationRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../repositories/SchemaCheckRepository.js';
import { SchemaLintRepository } from '../repositories/SchemaLintRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { TargetRepository } from '../repositories/TargetRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { AnalyticsDashboardViewRepository } from '../repositories/analytics/AnalyticsDashboardViewRepository.js';
import { AnalyticsRequestViewRepository } from '../repositories/analytics/AnalyticsRequestViewRepository.js';
import { MetricsRepository } from '../repositories/analytics/MetricsRepository.js';
import { MonthlyRequestViewRepository } from '../repositories/analytics/MonthlyRequestViewRepository.js';
import { RouterMetricsRepository } from '../repositories/analytics/RouterMetricsRepository.js';
import { SubgraphMetricsRepository } from '../repositories/analytics/SubgraphMetricsRepository.js';
import { TraceRepository } from '../repositories/analytics/TraceRepository.js';
import { UsageRepository } from '../repositories/analytics/UsageRepository.js';
import { parseTimeFilters } from '../repositories/analytics/util.js';
import type { RouterOptions } from '../routes.js';
import { AdmissionError } from '../services/AdmissionWebhookController.js';
import { ApiKeyGenerator } from '../services/ApiGenerator.js';
import ApolloMigrator from '../services/ApolloMigrator.js';
import { BillingService } from '../services/BillingService.js';
import OidcProvider from '../services/OidcProvider.js';
import {
  InspectorOperationResult,
  InspectorSchemaChange,
  SchemaUsageTrafficInspector,
  collectOperationUsageStats,
} from '../services/SchemaUsageTrafficInspector.js';
import Slack from '../services/Slack.js';
import {
  createRandomInternalLabel,
  enrichLogger,
  extractOperationNames,
  formatSubscriptionProtocol,
  getHighestPriorityRole,
  getLogger,
  handleError,
  isValidLabelMatchers,
  isValidLabels,
  isValidNamespaceName,
  isValidOrganizationName,
  isValidOrganizationSlug,
  validateDateRanges,
} from '../util.js';
import { FederatedGraphSchemaUpdate, OrganizationWebhookService } from '../webhooks/OrganizationWebhookService.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof PlatformService>> {
  return {
    /*
    Mutations
    */

    createNamespace: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateNamespaceResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        const isValid = isValidNamespaceName(req.name);
        if (!isValid) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details:
                'The provided name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
            },
          };
        }

        const namespace = await namespaceRepo.byName(req.name);
        if (namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: 'The namespace already exists.',
            },
          };
        }

        const ns = await namespaceRepo.create({
          name: req.name,
          createdBy: authContext.userId,
        });

        if (!ns) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not create namespace ${req.name}`,
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'namespace.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'namespace',
          auditableDisplayName: ns.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteNamespace: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteNamespaceResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db);

        if (req.name === DefaultNamespace) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'You cannot delete the default namespace',
            },
          };
        }

        const ns = await namespaceRepo.byName(req.name);
        if (!ns) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'The namespace was not found',
            },
          };
        }

        const orgMember = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: authContext.userId,
        });

        if (!orgMember) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User is not a part of this organization.',
            },
          };
        }

        // Ensure that only creator and admin can delete a namespace because it will delete all underlying resources
        if (ns.createdBy !== authContext.userId && !orgMember.roles.includes('admin')) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not have the permissions to delete the namespace.',
            },
          };
        }

        await opts.db.transaction(async (tx) => {
          const federatedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
          const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);
          const auditLogRepo = new AuditLogRepository(tx);

          const federatedGraphs = await federatedGraphRepo.list({
            namespaceId: ns.id,
            offset: 0,
            limit: 0,
          });

          const subgraphs = await subgraphRepo.list({
            namespaceId: ns.id,
            offset: 0,
            limit: 0,
          });

          await namespaceRepo.delete(req.name);

          for (const federatedGraph of federatedGraphs) {
            const blobStorageDirectory = `${authContext.organizationId}/${federatedGraph.id}`;
            await opts.blobStorage.removeDirectory({
              key: blobStorageDirectory,
            });

            await auditLogRepo.addAuditLog({
              organizationId: authContext.organizationId,
              auditAction: 'federated_graph.created',
              action: 'deleted',
              actorId: authContext.userId,
              auditableType: 'federated_graph',
              auditableDisplayName: federatedGraph.name,
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
              targetNamespaceId: federatedGraph.namespaceId,
              targetNamespaceDisplayName: federatedGraph.namespace,
            });
          }

          for (const subgraph of subgraphs) {
            await auditLogRepo.addAuditLog({
              organizationId: authContext.organizationId,
              auditAction: 'subgraph.deleted',
              action: 'deleted',
              actorId: authContext.userId,
              auditableType: 'subgraph',
              auditableDisplayName: subgraph.name,
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
              targetNamespaceId: subgraph.namespaceId,
              targetNamespaceDisplayName: subgraph.namespace,
            });
          }

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'namespace.deleted',
            action: 'deleted',
            actorId: authContext.userId,
            auditableType: 'namespace',
            auditableDisplayName: ns.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          });
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    renameNamespace: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<RenameNamespaceResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        const isValid = isValidNamespaceName(req.name);
        if (!isValid) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details:
                'The provided name is invalid. The name can contain letters and numbers separated by underscore or hyphens',
            },
          };
        }

        if (req.name === DefaultNamespace) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'You cannot rename the default namespace',
            },
          };
        }

        const exists = await namespaceRepo.byName(req.name);
        if (!exists) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'The namespace was not found',
            },
          };
        }

        await namespaceRepo.rename({
          ...req,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getNamespaces: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetNamespacesResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        const namespaces = await namespaceRepo.list();

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          namespaces,
        };
      });
    },

    moveMonograph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<MoveGraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const targetRepo = new TargetRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        const graph = await fedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: false,
        });

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Monograph '${req.name}' not found`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const exists = await fedGraphRepo.exists(req.name, req.newNamespace);
        if (exists) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `A graph '${req.name}' already exists in the namespace ${req.newNamespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: graph.targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const targetIds = [graph.targetId];

        const subgraphs = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
        });

        if (subgraphs.length > 0) {
          targetIds.push(subgraphs[0].targetId);
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId: subgraphs[0].targetId,
              targetType: 'subgraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });
        }

        const newNamespace = await namespaceRepo.byName(req.newNamespace);
        if (!newNamespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.newNamespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        await targetRepo.moveWithoutRecomposition({
          targetIds,
          newNamespaceId: newNamespace.id,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'monograph.moved',
          action: 'moved',
          actorId: authContext.userId,
          auditableType: 'monograph',
          auditableDisplayName: graph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: newNamespace.id,
          targetNamespaceDisplayName: newNamespace.name,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    migrateMonograph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<MigrateMonographResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        req.namespace = req.namespace || DefaultNamespace;

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        const graph = await fedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: false,
        });
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Monograph '${req.name}' not found`,
            },
            compositionErrors: [],
          };
        }

        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: graph.targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const subgraphs = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
        });

        if (subgraphs.length > 0) {
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId: subgraphs[0].targetId,
              targetType: 'subgraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });
        }

        await fedGraphRepo.enableFederationSupport({
          targetId: graph.targetId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
        };
      });
    },

    moveFederatedGraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<MoveGraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        const graph = await fedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: true,
        });
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const exists = await fedGraphRepo.exists(req.name, req.newNamespace);
        if (exists) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `A federated graph '${req.name}' already exists in the namespace ${req.newNamespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: graph.targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const newNamespace = await namespaceRepo.byName(req.newNamespace);
        if (!newNamespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.newNamespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const { compositionErrors, deploymentErrors } = await fedGraphRepo.move(
          {
            targetId: graph.targetId,
            newNamespaceId: newNamespace.id,
            updatedBy: authContext.userId,
            federatedGraph: graph,
          },
          opts.blobStorage,
          {
            cdnBaseUrl: opts.cdnBaseUrl,
            jwtSecret: opts.admissionWebhookJWTSecret,
          },
        );

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.moved',
          action: 'moved',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: graph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: newNamespace.id,
          targetNamespaceDisplayName: newNamespace.name,
        });

        orgWebhooks.send({
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: graph.id,
              name: graph.name,
              namespace: graph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
            actor_id: authContext.userId,
          },
        });

        const allDeploymentErrors: PlainMessage<DeploymentError>[] = [];

        allDeploymentErrors.push(
          ...deploymentErrors
            .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
            .map((e) => ({
              federatedGraphName: req.name,
              namespace: graph.namespace,
              message: e.message ?? '',
            })),
        );

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            deploymentErrors: [],
            compositionErrors: compositionErrors.map((e) => ({
              federatedGraphName: req.name,
              message: e.message,
              namespace: graph.namespace,
            })),
          };
        }

        if (deploymentErrors?.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            deploymentErrors: allDeploymentErrors,
            compositionErrors: [],
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    moveSubgraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<MoveGraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );

        const graph = await subgraphRepo.byName(req.name, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.name}' not found`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: graph.targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const { compositionErrors, updatedFederatedGraphs, deploymentErrors } = await opts.db.transaction(
          async (tx) => {
            const auditLogRepo = new AuditLogRepository(tx);
            const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
            const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);

            const exists = await subgraphRepo.exists(req.name, req.newNamespace);
            if (exists) {
              throw new PublicError(
                EnumStatusCode.ERR_ALREADY_EXISTS,
                `A subgraph '${req.name}' already exists in the namespace ${req.newNamespace}`,
              );
            }

            const newNamespace = await namespaceRepo.byName(req.newNamespace);
            if (!newNamespace) {
              throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, `Could not find namespace ${req.newNamespace}`);
            }

            const { compositionErrors, updatedFederatedGraphs, deploymentErrors } = await subgraphRepo.move(
              {
                targetId: graph.targetId,
                updatedBy: authContext.userId,
                subgraphId: graph.id,
                subgraphLabels: graph.labels,
                currentNamespaceId: graph.namespaceId,
                newNamespaceId: newNamespace.id,
              },
              opts.blobStorage,
              {
                cdnBaseUrl: opts.cdnBaseUrl,
                jwtSecret: opts.admissionWebhookJWTSecret,
              },
            );

            await auditLogRepo.addAuditLog({
              organizationId: authContext.organizationId,
              auditAction: 'subgraph.moved',
              action: 'moved',
              actorId: authContext.userId,
              auditableType: 'subgraph',
              auditableDisplayName: graph.name,
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
              targetNamespaceId: newNamespace.id,
              targetNamespaceDisplayName: newNamespace.name,
            });

            return { compositionErrors, updatedFederatedGraphs, deploymentErrors };
          },
        );

        const allDeploymentErrors: PlainMessage<DeploymentError>[] = [];

        allDeploymentErrors.push(
          ...deploymentErrors
            .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
            .map((e) => ({
              federatedGraphName: graph.name,
              namespace: graph.namespace,
              message: e.message ?? '',
            })),
        );

        for (const graph of updatedFederatedGraphs) {
          orgWebhooks.send({
            eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
            payload: {
              federated_graph: {
                id: graph.id,
                name: graph.name,
                namespace: graph.namespace,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              errors: compositionErrors.length > 0 || allDeploymentErrors.length > 0,
              actor_id: authContext.userId,
            },
          });
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
            deploymentErrors: [],
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            compositionErrors: [],
            deploymentErrors: allDeploymentErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    createMonograph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateMonographResponse>>(ctx, logger, async () => {
        return await opts.db.transaction(async (tx) => {
          req.namespace = req.namespace || DefaultNamespace;

          const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
          logger = enrichLogger(ctx, logger, authContext);

          const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
          const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
          const auditLogRepo = new AuditLogRepository(opts.db);
          const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

          if (!authContext.hasWriteAccess) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `The user doesn't have the permissions to perform this operation`,
              },
            };
          }

          const namespace = await namespaceRepo.byName(req.namespace);
          if (!namespace) {
            return {
              response: {
                code: EnumStatusCode.ERR_NOT_FOUND,
                details: `Could not find namespace ${req.namespace}`,
              },
            };
          }

          if (await fedGraphRepo.exists(req.name, req.namespace)) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `Graph '${req.name}' already exists in the namespace`,
              },
            };
          }

          if (await subgraphRepo.exists(req.name, req.namespace)) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `The subgraph ${req.name} being created for the monograph already exists in the namespace`,
              },
            };
          }

          if (!isValidUrl(req.routingUrl)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Routing URL is not a valid URL`,
              },
            };
          }

          if (!isValidUrl(req.graphUrl)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Graph URL is not a valid URL`,
              },
            };
          }

          const count = await fedGraphRepo.count();

          const feature = await orgRepo.getFeature({
            organizationId: authContext.organizationId,
            featureId: 'federated-graphs',
          });

          const limit = feature?.limit === -1 ? undefined : feature?.limit;

          if (limit && count >= limit) {
            return {
              response: {
                code: EnumStatusCode.ERR_LIMIT_REACHED,
                details: `The organization reached the limit of federated graphs and monographs`,
              },
            };
          }

          const label = createRandomInternalLabel();

          const labelMatchers = [joinLabel(label)];

          const subgraph = await subgraphRepo.create({
            name: req.name,
            namespace: req.namespace,
            namespaceId: namespace.id,
            createdBy: authContext.userId,
            labels: [label],
            routingUrl: req.graphUrl,
            readme: req.readme,
            subscriptionUrl: req.subscriptionUrl,
            subscriptionProtocol: req.subscriptionProtocol
              ? formatSubscriptionProtocol(req.subscriptionProtocol)
              : undefined,
          });

          if (!subgraph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Could not create monograph`,
              },
            };
          }

          const graph = await fedGraphRepo.create({
            name: req.name,
            createdBy: authContext.userId,
            labelMatchers,
            routingUrl: req.routingUrl,
            readme: req.readme,
            namespace: req.namespace,
            namespaceId: namespace.id,
            admissionWebhookURL: req.admissionWebhookURL,
            supportsFederation: false,
          });

          if (!graph) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Could not create monograph`,
              },
            };
          }

          await fedGraphRepo.createGraphCryptoKeyPairs({
            federatedGraphId: graph.id,
            organizationId: authContext.organizationId,
          });

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'monograph.created',
            action: 'created',
            actorId: authContext.userId,
            auditableType: 'monograph',
            auditableDisplayName: graph.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            targetNamespaceId: graph.namespaceId,
            targetNamespaceDisplayName: graph.namespace,
          });

          return {
            response: {
              code: EnumStatusCode.OK,
            },
          };
        });
      });
    },

    createFederatedGraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateFederatedGraphResponse>>(ctx, logger, async () => {
        req.namespace = req.namespace || DefaultNamespace;

        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesn't have the permissions to perform this operation`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.namespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (await fedGraphRepo.exists(req.name, req.namespace)) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Federated graph '${req.name}' already exists in the namespace`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (!isValidLabelMatchers(req.labelMatchers)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One or more labels in the matcher were found to be invalid`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (!isValidUrl(req.routingUrl)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Routing URL is not a valid URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (req.admissionWebhookURL && !isValidUrl(req.admissionWebhookURL)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Admission Webhook URL is not a valid URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const count = await fedGraphRepo.count();

        const feature = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'federated-graphs',
        });

        const limit = feature?.limit === -1 ? undefined : feature?.limit;

        if (limit && count >= limit) {
          return {
            response: {
              code: EnumStatusCode.ERR_LIMIT_REACHED,
              details: `The organization reached the limit of federated graphs`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const federatedGraph = await fedGraphRepo.create({
          name: req.name,
          createdBy: authContext.userId,
          labelMatchers: req.labelMatchers,
          routingUrl: req.routingUrl,
          readme: req.readme,
          namespace: req.namespace,
          namespaceId: namespace.id,
          admissionWebhookURL: req.admissionWebhookURL,
        });

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Could not create federated graph`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        await fedGraphRepo.createGraphCryptoKeyPairs({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: federatedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: federatedGraph.namespaceId,
          targetNamespaceDisplayName: federatedGraph.namespace,
        });

        const subgraphs = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: federatedGraph.targetId,
          published: true,
        });

        // If there are no subgraphs, we don't need to compose anything
        // and avoid producing a version with a composition error
        if (subgraphs.length === 0) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const compositionErrors: PlainMessage<CompositionError>[] = [];
        const deploymentErrors: PlainMessage<DeploymentError>[] = [];

        await opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
          const composer = new Composer(logger, fedGraphRepo, subgraphRepo);
          const composition = await composer.composeFederatedGraph(federatedGraph);

          compositionErrors.push(
            ...composition.errors.map((e) => ({
              federatedGraphName: federatedGraph.name,
              namespace: federatedGraph.namespace,
              message: e.message,
            })),
          );

          const deployment = await composer.deployComposition({
            composedGraph: composition,
            composedBy: authContext.userId,
            blobStorage: opts.blobStorage,
            organizationId: authContext.organizationId,
            admissionWebhookURL: federatedGraph.admissionWebhookURL,
            admissionConfig: {
              cdnBaseUrl: opts.cdnBaseUrl,
              jwtSecret: opts.admissionWebhookJWTSecret,
            },
          });

          deploymentErrors.push(
            ...deployment.errors
              .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
              .map((e) => ({
                federatedGraphName: composition.name,
                namespace: composition.namespace,
                message: e.message ?? '',
              })),
          );
        });

        orgWebhooks.send({
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: federatedGraph.id,
              name: federatedGraph.name,
              namespace: federatedGraph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
            actor_id: authContext.userId,
          },
        });

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
            deploymentErrors: [],
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            compositionErrors: [],
            deploymentErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    createFederatedSubgraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateFederatedSubgraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have the permissions to perform this operation`,
            },
            compositionErrors: [],
            admissionErrors: [],
          };
        }

        if (!isValidLabels(req.labels)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One or more labels were found to be invalid`,
            },
            compositionErrors: [],
            admissionErrors: [],
          };
        }

        if (!isValidUrl(req.routingUrl)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Routing URL is not a valid URL`,
            },
            compositionErrors: [],
            admissionErrors: [],
          };
        }

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.namespace}`,
            },
            graphs: [],
          };
        }

        const exists = await subgraphRepo.exists(req.name, req.namespace);
        if (exists) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Subgraph with the name ${req.name} already exists in the namespace ${req.namespace} `,
            },
            compositionErrors: [],
            admissionErrors: [],
          };
        }

        const subgraph = await subgraphRepo.create({
          name: req.name,
          namespace: req.namespace,
          namespaceId: namespace.id,
          createdBy: authContext.userId,
          labels: req.labels,
          routingUrl: req.routingUrl,
          readme: req.readme,
          subscriptionUrl: req.subscriptionUrl,
          subscriptionProtocol: req.subscriptionProtocol
            ? formatSubscriptionProtocol(req.subscriptionProtocol)
            : undefined,
        });

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Subgraph '${req.name}' could not be created`,
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'subgraph.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'subgraph',
          auditableDisplayName: subgraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    checkSubgraphSchema: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CheckSubgraphSchemaResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const schemaLintRepo = new SchemaLintRepository(opts.db);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have the permissions to perform this operation`,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: '',
            checkedFederatedGraphs: [],
            lintWarnings: [],
            lintErrors: [],
          };
        }

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: '',
            checkedFederatedGraphs: [],
            lintWarnings: [],
            lintErrors: [],
          };
        }

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Namespace '${req.namespace}' not found`,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: '',
            checkedFederatedGraphs: [],
            lintWarnings: [],
            lintErrors: [],
          };
        }

        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: '',
            checkedFederatedGraphs: [],
            lintWarnings: [],
            lintErrors: [],
          };
        }

        const newSchemaSDL = req.delete ? '' : new TextDecoder().decode(req.schema);

        const schemaCheckID = await schemaCheckRepo.create({
          targetId: subgraph.targetId,
          isDeleted: !!req.delete,
          proposedSubgraphSchemaSDL: newSchemaSDL,
        });

        const schemaChanges = await getDiffBetweenGraphs(subgraph.schemaSDL, newSchemaSDL);
        if (schemaChanges.kind === 'failure') {
          logger.warn(`Error finding diff between graphs: ${schemaChanges.error}`);
          return {
            response: {
              code: schemaChanges.errorCode,
              details: schemaChanges.errorMessage,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
            checkId: schemaCheckID,
            checkedFederatedGraphs: [],
            lintWarnings: [],
            lintErrors: [],
          };
        }

        let isInspectable = true;
        const hasBreakingChanges = schemaChanges.breakingChanges.length > 0;

        await schemaCheckRepo.createSchemaCheckChanges({
          changes: schemaChanges.nonBreakingChanges,
          schemaCheckID,
        });

        const storedBreakingChanges = await schemaCheckRepo.createSchemaCheckChanges({
          changes: schemaChanges.breakingChanges,
          schemaCheckID,
        });

        const composer = new Composer(logger, fedGraphRepo, subgraphRepo);

        const result = req.delete
          ? await composer.composeWithDeletedSubgraph(subgraph.labels, subgraph.name, subgraph.namespaceId)
          : await composer.composeWithProposedSDL(subgraph.labels, subgraph.name, subgraph.namespaceId, newSchemaSDL);

        await schemaCheckRepo.createSchemaCheckCompositions({
          schemaCheckID,
          compositions: result.compositions,
        });

        let hasClientTraffic = false;

        const trafficInspector = new SchemaUsageTrafficInspector(opts.chClient!);
        const inspectedOperations: InspectorOperationResult[] = [];
        const compositionErrors: PlainMessage<CompositionError>[] = [];

        let inspectorChanges: InspectorSchemaChange[] = [];
        try {
          // For operations checks we only consider breaking changes
          // This method will throw if the schema changes cannot be converted to inspector changes
          inspectorChanges = trafficInspector.schemaChangesToInspectorChanges(
            schemaChanges.breakingChanges,
            storedBreakingChanges,
          );
        } catch {
          isInspectable = false;
        }

        const changeRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'breaking-change-retention',
        });

        const limit = changeRetention?.limit ?? 7;

        for (const composition of result.compositions) {
          await schemaCheckRepo.createCheckedFederatedGraph(schemaCheckID, composition.id, limit);

          // We collect composition errors for all federated graphs
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
                namespace: composition.namespace,
              });
            }
          }

          // We don't collect operation usage when we have composition errors or
          // when we don't have any inspectable changes. That means any breaking change is really breaking
          if (composition.errors.length === 0 && isInspectable && inspectorChanges.length > 0) {
            if (limit <= 0) {
              continue;
            }

            const result = await trafficInspector.inspect(inspectorChanges, {
              daysToConsider: limit,
              federatedGraphId: composition.id,
              organizationId: authContext.organizationId,
            });

            if (result.size > 0) {
              const overrideCheck = await schemaCheckRepo.checkClientTrafficAgainstOverrides({
                changes: storedBreakingChanges,
                inspectorResultsByChangeId: result,
                namespaceId: composition.namespaceId,
              });

              hasClientTraffic = overrideCheck.hasUnsafeClientTraffic;

              // Store operation usage
              await schemaCheckRepo.createOperationUsage(overrideCheck.result, composition.id);

              // Collect all inspected operations for later aggregation
              for (const resultElement of overrideCheck.result.values()) {
                inspectedOperations.push(...resultElement);
              }
            }
          }
        }

        let lintIssues: SchemaLintIssues = { warnings: [], errors: [] };
        if (namespace.enableLinting && newSchemaSDL !== '') {
          const lintConfigs = await schemaLintRepo.getNamespaceLintConfig(namespace.id);
          if (lintConfigs.length > 0) {
            lintIssues = await schemaLintCheck({
              schema: newSchemaSDL,
              rulesInput: lintConfigs,
            });
          }
        }

        await schemaLintRepo.addSchemaCheckLintIssues({
          schemaCheckId: schemaCheckID,
          lintIssues: [...lintIssues.warnings, ...lintIssues.errors],
        });

        // Update the overall schema check with the results
        await schemaCheckRepo.update({
          schemaCheckID,
          hasClientTraffic,
          hasBreakingChanges,
          hasLintErrors: lintIssues.errors.length > 0,
        });

        if (req.gitInfo && opts.githubApp) {
          try {
            const githubRepo = new GitHubRepository(opts.db, opts.githubApp);
            await githubRepo.createCommitCheck({
              schemaCheckID,
              gitInfo: req.gitInfo,
              compositionErrors,
              breakingChangesCount: schemaChanges.breakingChanges.length,
              hasClientTraffic,
              subgraphName: subgraph.name,
              organizationSlug: org.slug,
              webBaseUrl: opts.webBaseUrl,
              composedGraphs: result.compositions.map((c) => c.name),
            });
          } catch (e) {
            logger.error(e, 'Error creating commit check');
          }
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          breakingChanges: schemaChanges.breakingChanges,
          nonBreakingChanges: schemaChanges.nonBreakingChanges,
          operationUsageStats: isInspectable ? collectOperationUsageStats(inspectedOperations) : undefined,
          compositionErrors,
          checkId: schemaCheckID,
          checkedFederatedGraphs: result.compositions.map((c) => ({
            id: c.id,
            name: c.name,
            namespace: c.namespace,
            organizationSlug: authContext.organizationSlug,
          })),
          lintWarnings: lintIssues.warnings,
          lintErrors: lintIssues.errors,
        };
      });
    },

    fixSubgraphSchema: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<FixSubgraphSchemaResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const composer = new Composer(logger, fedGraphRepo, subgraphRepo);

        req.namespace = req.namespace || DefaultNamespace;

        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            modified: false,
            schema: '',
          };
        }

        // Avoid calling OpenAI API if the schema is too big
        if (req.schema.length > 10_000) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The schema is too big to be fixed automatically`,
            },
            modified: false,
            schema: '',
          };
        }

        if (!opts.openaiApiKey) {
          return {
            response: {
              code: EnumStatusCode.ERR_OPENAI_DISABLED,
              details: `Env var 'OPENAI_API_KEY' must be set to use this feature`,
            },
            modified: false,
            schema: '',
          };
        }

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const feature = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'ai',
        });

        if (!feature?.enabled) {
          return {
            response: {
              code: EnumStatusCode.ERR_OPENAI_DISABLED,
              details: `The organization must enable the AI feature to use this feature`,
            },
            modified: false,
            schema: '',
          };
        }

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            modified: false,
            schema: '',
          };
        }
        const newSchemaSDL = req.schema;

        try {
          // Here we check if the schema is valid as a subgraph
          const { errors } = buildSchema(newSchemaSDL);
          if (errors && errors.length > 0) {
            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
                details: errors.map((e) => e.toString()).join('\n'),
              },
              modified: false,
              schema: '',
            };
          }
        } catch (e: any) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
              details: e.message,
            },
            modified: false,
            schema: '',
          };
        }

        const result = await composer.composeWithProposedSDL(
          subgraph.labels,
          subgraph.name,
          subgraph.namespaceId,
          newSchemaSDL,
        );

        const compositionErrors: PlainMessage<CompositionError>[] = [];
        for (const composition of result.compositions) {
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
                namespace: composition.namespace,
              });
            }
          }
        }

        if (compositionErrors.length === 0) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            modified: false,
            schema: '',
          };
        }

        const checkResult = compositionErrors
          .filter((e) => e.federatedGraphName !== req.subgraphName)
          .map((e) => e.message)
          .join('\n\n');

        const ai = new OpenAIGraphql({
          openAiApiKey: opts.openaiApiKey,
        });

        const fixResult = await ai.fixSDL({
          sdl: newSchemaSDL,
          checkResult,
        });

        if (fixResult.sdl === newSchemaSDL) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            modified: false,
            schema: '',
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          modified: true,
          schema: fixResult.sdl,
        };
      });
    },

    publishMonograph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<PublishMonographResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        const graph = await federatedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: false,
        });
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `The graph ${req.name} was not found in namespace ${req.namespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have the permissions to perform this operation`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const subgraphSchemaSDL = req.schema;

        try {
          // Here we check if the schema is valid as a subgraph SDL
          const { errors } = buildSchema(subgraphSchemaSDL);
          if (errors && errors.length > 0) {
            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
                details: errors.map((e) => e.toString()).join('\n'),
              },
              compositionErrors: [],
              deploymentErrors: [],
            };
          }
        } catch (e: any) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
              details: e.message,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.namespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const subgraphs = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
        });

        if (subgraphs.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find any subgraphs in the monograph ${req.name}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: subgraphs[0].targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const { compositionErrors, updatedFederatedGraphs, deploymentErrors } = await subgraphRepo.update(
          {
            targetId: subgraphs[0].targetId,
            labels: [],
            unsetLabels: false,
            schemaSDL: subgraphSchemaSDL,
            updatedBy: authContext.userId,
            namespaceId: namespace.id,
          },
          opts.blobStorage,
          {
            cdnBaseUrl: opts.cdnBaseUrl,
            webhookJWTSecret: opts.admissionWebhookJWTSecret,
          },
        );

        for (const graph of updatedFederatedGraphs) {
          orgWebhooks.send({
            eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
            payload: {
              monograph: {
                id: graph.id,
                name: graph.name,
                namespace: graph.namespace,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              actor_id: authContext.userId,
            },
          });
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'monograph.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'monograph',
          auditableDisplayName: graph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });

        if (
          opts.openaiApiKey &&
          // Avoid calling OpenAI API if the schema is too big.
          // Best effort approach. This way of counting tokens is not accurate.
          subgraphSchemaSDL.length <= 10_000
        ) {
          const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
          const feature = await orgRepo.getFeature({
            organizationId: authContext.organizationId,
            featureId: 'ai',
          });

          if (feature?.enabled) {
            try {
              await opts.readmeQueue.addJob({
                organizationId: authContext.organizationId,
                targetId: subgraphs[0].targetId,
                type: 'subgraph',
              });
            } catch (e) {
              logger.error(e, `Error adding job to subgraph readme queue`);
              // Swallow error because this is not critical
            }
          }
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
            deploymentErrors: [],
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            compositionErrors: [],
            deploymentErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    publishFederatedSubgraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<PublishFederatedSubgraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const subgraphSchemaSDL = req.schema;

        try {
          // Here we check if the schema is valid as a subgraph SDL
          const { errors } = buildSchema(subgraphSchemaSDL);
          if (errors && errors.length > 0) {
            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
                details: errors.map((e) => e.toString()).join('\n'),
              },
              compositionErrors: [],
              deploymentErrors: [],
            };
          }
        } catch (e: any) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
              details: e.message,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.namespace}`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        let subgraph = await subgraphRepo.byName(req.name, req.namespace);

        // Check if the subgraph already exists and if it doesn't, validate input and create it
        if (subgraph) {
          // check if the user is authorized to perform the action
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId: subgraph.targetId,
              targetType: 'subgraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });
        } else {
          if (!isValidLabels(req.labels)) {
            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_LABELS,
                details: `One or more labels were found to be invalid`,
              },
              compositionErrors: [],
              deploymentErrors: [],
            };
          }

          if (!req.routingUrl) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Routing URL is required to create a new subgraph`,
              },
              compositionErrors: [],
              deploymentErrors: [],
            };
          }

          if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Subscription URL is not a valid URL`,
              },
              compositionErrors: [],
              deploymentErrors: [],
            };
          }

          // Create the subgraph if it doesn't exist
          subgraph = await subgraphRepo.create({
            name: req.name,
            namespace: req.namespace,
            namespaceId: namespace.id,
            createdBy: authContext.userId,
            labels: req.labels,
            routingUrl: req.routingUrl!,
            subscriptionUrl: req.subscriptionUrl,
            subscriptionProtocol: req.subscriptionProtocol
              ? formatSubscriptionProtocol(req.subscriptionProtocol)
              : undefined,
          });

          if (!subgraph) {
            throw new Error(`Subgraph '${req.name}' could not be created`);
          }

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'subgraph.created',
            action: 'created',
            actorId: authContext.userId,
            auditableType: 'subgraph',
            auditableDisplayName: subgraph.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            targetNamespaceId: subgraph.namespaceId,
            targetNamespaceDisplayName: subgraph.namespace,
          });
        }

        const { compositionErrors, updatedFederatedGraphs, deploymentErrors } = await subgraphRepo.update(
          {
            targetId: subgraph.targetId,
            labels: req.labels,
            unsetLabels: req.unsetLabels ?? false,
            routingUrl: req.routingUrl,
            subscriptionUrl: req.subscriptionUrl,
            schemaSDL: subgraphSchemaSDL,
            subscriptionProtocol: req.subscriptionProtocol
              ? formatSubscriptionProtocol(req.subscriptionProtocol)
              : undefined,
            updatedBy: authContext.userId,
            namespaceId: namespace.id,
          },
          opts.blobStorage,
          {
            cdnBaseUrl: opts.cdnBaseUrl,
            webhookJWTSecret: opts.admissionWebhookJWTSecret,
          },
        );

        for (const graph of updatedFederatedGraphs) {
          orgWebhooks.send({
            eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
            payload: {
              federated_graph: {
                id: graph.id,
                name: graph.name,
                namespace: graph.namespace,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
              actor_id: authContext.userId,
            },
          });
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'subgraph.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'subgraph',
          auditableDisplayName: subgraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });

        if (
          opts.openaiApiKey &&
          // Avoid calling OpenAI API if the schema is too big.
          // Best effort approach. This way of counting tokens is not accurate.
          subgraph.schemaSDL.length <= 10_000
        ) {
          const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
          const feature = await orgRepo.getFeature({
            organizationId: authContext.organizationId,
            featureId: 'ai',
          });

          if (feature?.enabled) {
            try {
              await opts.readmeQueue.addJob({
                organizationId: authContext.organizationId,
                targetId: subgraph.targetId,
                type: 'subgraph',
              });
            } catch (e) {
              logger.error(e, `Error adding job to subgraph readme queue`);
              // Swallow error because this is not critical
            }
          }
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
            deploymentErrors: [],
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            compositionErrors: [],
            deploymentErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    forceCheckSuccess: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<ForceCheckSuccessResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
          };
        }

        const check = await subgraphRepo.checkById({ id: req.checkId, federatedGraphTargetId: graph.targetId });

        if (!check) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check does not exist',
            },
          };
        }

        const githubDetails = await subgraphRepo.forceCheckSuccess(check.id);

        if (githubDetails && opts.githubApp) {
          const githubRepo = new GitHubRepository(opts.db, opts.githubApp);
          await githubRepo.markCheckAsSuccess({
            ...githubDetails,
          });
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createOperationOverrides: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateOperationOverridesResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have permissions to perform this operation`,
            },
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        const affectedChanges = await operationsRepo.createOperationOverrides({
          namespaceId: graph.namespaceId,
          operationHash: req.operationHash,
          operationName: req.operationName,
          changes: req.changes,
          actorId: authContext.userId,
        });

        if (affectedChanges.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Could not create overrides for this operation.',
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'operation_change_override.created',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'operation_change_override',
          auditableDisplayName: req.operationHash,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeOperationOverrides: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<RemoveOperationOverridesResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have permissions to perform this operation.`,
            },
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist.',
            },
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        await operationsRepo.removeOperationOverrides({
          operationHash: req.operationHash,
          namespaceId: graph.namespaceId,
          changes: req.changes,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'operation_change_override.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'operation_change_override',
          auditableDisplayName: req.operationHash,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeOperationIgnoreAllOverride: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<RemoveOperationIgnoreAllOverrideResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have permissions to perform this operation`,
            },
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        const affectedChanges = await operationsRepo.removeIgnoreAllOverride({
          namespaceId: graph.namespaceId,
          operationHash: req.operationHash,
        });

        if (affectedChanges.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Could not remove ignore override for this operation',
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'operation_ignore_all_override.deleted',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'operation_ignore_all_override',
          auditableDisplayName: req.operationHash,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createOperationIgnoreAllOverride: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateOperationIgnoreAllOverrideResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have permissions to perform this operation`,
            },
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        const affectedChanges = await operationsRepo.createIgnoreAllOverride({
          namespaceId: graph.namespaceId,
          operationHash: req.operationHash,
          operationName: req.operationName,
          actorId: authContext.userId,
        });

        if (affectedChanges.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Could not create ignore override for this operation',
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'operation_ignore_all_override.created',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'operation_ignore_all_override',
          auditableDisplayName: req.operationHash,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getOperationOverrides: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOperationOverridesResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have permissions to perform this operation`,
            },
            changes: [],
            ignoreAll: false,
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            changes: [],
            ignoreAll: false,
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        const overrides = await operationsRepo.getChangeOverridesByOperationHash({
          operationHash: req.operationHash,
          namespaceId: graph.namespaceId,
        });

        const ignoreAll = await operationsRepo.hasIgnoreAllOverride({
          operationHash: req.operationHash,
          namespaceId: graph.namespaceId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          changes: overrides.map((o) => ({
            changeType: o.changeType,
            path: o.path ?? undefined,
          })),
          ignoreAll,
        };
      });
    },

    getAllOverrides: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetAllOverridesResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user does not have permissions to perform this operation`,
            },
            overrides: [],
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            overrides: [],
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        const overrides = await operationsRepo.getConsolidatedOverridesView({
          namespaceId: graph.namespaceId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          overrides,
        };
      });
    },

    deleteMonograph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteMonographResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        req.namespace = req.namespace || DefaultNamespace;

        return await opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
          const auditLogRepo = new AuditLogRepository(tx);

          if (!authContext.hasWriteAccess) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `The user does not have the permissions to perform this operation`,
              },
            };
          }

          const graph = await fedGraphRepo.byName(req.name, req.namespace, {
            supportsFederation: false,
          });

          if (!graph) {
            return {
              response: {
                code: EnumStatusCode.ERR_NOT_FOUND,
                details: `Graph '${req.name}' not found`,
              },
            };
          }

          // check if the user is authorized to perform the action
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId: graph.targetId,
              targetType: 'federatedGraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });

          const subgraphs = await subgraphRepo.listByFederatedGraph({
            federatedGraphTargetId: graph.targetId,
          });

          const blobStorageDirectory = `${authContext.organizationId}/${graph.id}`;
          await opts.blobStorage.removeDirectory({ key: blobStorageDirectory });

          await fedGraphRepo.delete(graph.targetId);

          if (subgraphs.length === 1) {
            await subgraphRepo.delete(subgraphs[0].targetId);
          }

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'monograph.deleted',
            action: 'deleted',
            actorId: authContext.userId,
            auditableType: 'monograph',
            auditableDisplayName: graph.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            targetNamespaceId: graph.namespaceId,
            targetNamespaceDisplayName: graph.namespace,
          });

          return {
            response: {
              code: EnumStatusCode.OK,
            },
          };
        });
      });
    },

    deleteFederatedGraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteFederatedGraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: true,
        });
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
          };
        }

        // check if the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: federatedGraph.targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const blobStorageDirectory = `${authContext.organizationId}/${federatedGraph.id}`;
        await opts.blobStorage.removeDirectory({
          key: blobStorageDirectory,
        });

        await fedGraphRepo.delete(federatedGraph.targetId);

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: federatedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: federatedGraph.namespaceId,
          targetNamespaceDisplayName: federatedGraph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteFederatedSubgraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteFederatedSubgraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        // check if the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: subgraph.targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const federatedGraphSchemaUpdates: FederatedGraphSchemaUpdate[] = [];
        const deploymentErrors: PlainMessage<DeploymentError>[] = [];
        const compositionErrors: PlainMessage<CompositionError>[] = [];

        await opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
          const namespaceRepo = new NamespaceRepository(tx, authContext.organizationId);
          const composer = new Composer(logger, fedGraphRepo, subgraphRepo);
          const auditLogRepo = new AuditLogRepository(tx);

          // Collect all federated graphs that used this subgraph before deleting subgraph to include them in the composition
          const affectedFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
            labels: subgraph.labels,
            namespaceId: subgraph.namespaceId,
          });

          // Delete the subgraph
          await subgraphRepo.delete(subgraph.targetId);

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'subgraph.deleted',
            action: 'deleted',
            actorId: authContext.userId,
            auditableType: 'subgraph',
            auditableDisplayName: subgraph.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            targetNamespaceId: subgraph.namespaceId,
            targetNamespaceDisplayName: subgraph.namespace,
          });

          // Collect all federated graphs that use this subgraph after deleting the subgraph
          const currentFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
            labels: subgraph.labels,
            namespaceId: subgraph.namespaceId,
          });

          // Remove duplicates
          for (const federatedGraph of currentFederatedGraphs) {
            const exists = affectedFederatedGraphs.find((g) => g.name === federatedGraph.name);
            if (!exists) {
              affectedFederatedGraphs.push(federatedGraph);
            }
          }

          // Validate all federated graphs that use this subgraph.
          for (const federatedGraph of affectedFederatedGraphs) {
            const composition = await composer.composeFederatedGraph(federatedGraph);

            const namespace = await namespaceRepo.byTargetId(composition.targetID);
            if (!namespace) {
              throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, 'Could not find namespace');
            }

            // Collect all composition errors
            compositionErrors.push(
              ...composition.errors.map((e) => ({
                federatedGraphName: composition.name,
                namespace: composition.namespace,
                message: e.message,
              })),
            );

            const deployment = await composer.deployComposition({
              composedGraph: composition,
              composedBy: authContext.userId,
              blobStorage: opts.blobStorage,
              organizationId: authContext.organizationId,
              admissionWebhookURL: federatedGraph.admissionWebhookURL,
              admissionConfig: {
                cdnBaseUrl: opts.cdnBaseUrl,
                jwtSecret: opts.admissionWebhookJWTSecret,
              },
            });

            deploymentErrors.push(
              ...deployment.errors
                .filter((e) => e instanceof AdmissionError || e instanceof RouterConfigUploadError)
                .map((e) => ({
                  federatedGraphName: composition.name,
                  namespace: composition.namespace,
                  message: e.message ?? '',
                })),
            );

            federatedGraphSchemaUpdates.push({
              eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
              payload: {
                federated_graph: {
                  id: composition.targetID,
                  name: composition.name,
                  namespace: namespace.name,
                },
                organization: {
                  id: authContext.organizationId,
                  slug: authContext.organizationSlug,
                },
                errors: composition.errors.length > 0 || deploymentErrors.length > 0,
                actor_id: authContext.userId,
              },
            });
          }
        });

        for (const update of federatedGraphSchemaUpdates) {
          orgWebhooks.send(update);
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            deploymentErrors: [],
            compositionErrors,
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            deploymentErrors,
            compositionErrors: [],
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          deploymentErrors: [],
          compositionErrors: [],
        };
      });
    },

    updateMonograph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateMonographResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        req.namespace = req.namespace || DefaultNamespace;

        return opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
          const auditLogRepo = new AuditLogRepository(tx);
          const orgWebhooks = new OrganizationWebhookService(
            tx,
            authContext.organizationId,
            opts.logger,
            opts.billingDefaultPlanId,
          );

          if (!authContext.hasWriteAccess) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `The user doesnt have the permissions to perform this operation`,
              },
              compositionErrors: [],
            };
          }

          if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Subscription URL is not a valid URL`,
              },
              compositionErrors: [],
            };
          }

          if (req.routingUrl && !isValidUrl(req.routingUrl)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Routing URL is not a valid URL`,
              },
              compositionErrors: [],
            };
          }

          if (req.graphUrl && !isValidUrl(req.graphUrl)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Graph URL is not a valid URL`,
              },
              compositionErrors: [],
            };
          }

          const graph = await fedGraphRepo.byName(req.name, req.namespace, {
            supportsFederation: false,
          });
          if (!graph) {
            return {
              response: {
                code: EnumStatusCode.ERR_NOT_FOUND,
                details: `Monograph '${req.name}' not found`,
              },
              compositionErrors: [],
            };
          }

          const subgraphs = await subgraphRepo.listByFederatedGraph({
            federatedGraphTargetId: graph.targetId,
          });

          if (subgraphs.length === 0) {
            return {
              response: {
                code: EnumStatusCode.ERR_NOT_FOUND,
                details: `Monograph '${req.name}' does not have any subgraphs`,
              },
              compositionErrors: [],
            };
          }

          const subgraph = subgraphs[0];

          // check if the user is authorized to perform the action
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId: graph.targetId,
              targetType: 'federatedGraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });

          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId: subgraphs[0].targetId,
              targetType: 'subgraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });

          await fedGraphRepo.update({
            targetId: graph.targetId,
            labelMatchers: [],
            routingUrl: req.routingUrl,
            updatedBy: authContext.userId,
            readme: req.readme,
            blobStorage: opts.blobStorage,
            namespaceId: graph.namespaceId,
            unsetLabelMatchers: false,
            admissionConfig: {
              cdnBaseUrl: opts.cdnBaseUrl,
              jwtSecret: opts.admissionWebhookJWTSecret,
            },
          });

          await subgraphRepo.update(
            {
              targetId: subgraph.targetId,
              labels: [],
              unsetLabels: false,
              subscriptionUrl: req.subscriptionUrl,
              routingUrl: req.graphUrl,
              subscriptionProtocol: req.subscriptionProtocol
                ? formatSubscriptionProtocol(req.subscriptionProtocol)
                : undefined,
              updatedBy: authContext.userId,
              readme: req.readme,
              namespaceId: subgraph.namespaceId,
            },
            opts.blobStorage,
            {
              cdnBaseUrl: opts.cdnBaseUrl,
              webhookJWTSecret: opts.admissionWebhookJWTSecret,
            },
          );

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'monograph.updated',
            action: 'updated',
            actorId: authContext.userId,
            auditableType: 'monograph',
            auditableDisplayName: graph.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            targetNamespaceId: graph.namespaceId,
            targetNamespaceDisplayName: graph.namespace,
          });

          orgWebhooks.send({
            eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED,
            payload: {
              monograph: {
                id: graph.id,
                name: graph.name,
                namespace: graph.namespace,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              actor_id: authContext.userId,
            },
          });

          return {
            response: {
              code: EnumStatusCode.OK,
            },
            compositionErrors: [],
          };
        });
      });
    },

    updateFederatedGraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateFederatedGraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: true,
        });
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        // check if the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: federatedGraph.targetId,
            targetType: 'federatedGraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        if (!isValidLabelMatchers(req.labelMatchers)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One or more labels in the matcher were found to be invalid`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (req.admissionWebhookURL && !isValidUrl(req.admissionWebhookURL)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Admission Webhook URL is not a valid URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const deploymentErrors: PlainMessage<DeploymentError>[] = [];
        let compositionErrors: PlainMessage<CompositionError>[] = [];

        const result = await fedGraphRepo.update({
          targetId: federatedGraph.targetId,
          labelMatchers: req.labelMatchers,
          routingUrl: req.routingUrl,
          updatedBy: authContext.userId,
          readme: req.readme,
          blobStorage: opts.blobStorage,
          namespaceId: federatedGraph.namespaceId,
          unsetLabelMatchers: req.unsetLabelMatchers,
          admissionWebhookURL: req.admissionWebhookURL,
          admissionConfig: {
            cdnBaseUrl: opts.cdnBaseUrl,
            jwtSecret: opts.admissionWebhookJWTSecret,
          },
        });

        if (result?.deploymentErrors) {
          deploymentErrors.push(...result.deploymentErrors);
        }

        if (result?.compositionErrors) {
          compositionErrors = result.compositionErrors.map((e) => ({
            federatedGraphName: req.name,
            namespace: federatedGraph.namespace,
            message: e.message,
          }));
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: federatedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: federatedGraph.namespaceId,
          targetNamespaceDisplayName: federatedGraph.namespace,
        });

        orgWebhooks.send({
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: federatedGraph.id,
              name: federatedGraph.name,
              namespace: federatedGraph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
            actor_id: authContext.userId,
          },
        });

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            deploymentErrors: [],
            compositionErrors,
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            deploymentErrors,
            compositionErrors: [],
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    updateSubgraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateSubgraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        if (!isValidLabels(req.labels)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One ore more labels were found to be invalid`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const subgraph = await subgraphRepo.byName(req.name, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.name}' not found`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        // Check if the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: subgraph.targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        // When un-setting the url, the url can be empty string
        if (req.subscriptionUrl && !isValidUrl(req.subscriptionUrl)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Subscription URL is not a valid URL`,
            },
            compositionErrors: [],
            deploymentErrors: [],
          };
        }

        const { compositionErrors, updatedFederatedGraphs, deploymentErrors } = await subgraphRepo.update(
          {
            targetId: subgraph.targetId,
            labels: req.labels,
            unsetLabels: req.unsetLabels ?? false,
            subscriptionUrl: req.subscriptionUrl,
            routingUrl: req.routingUrl,
            subscriptionProtocol: req.subscriptionProtocol
              ? formatSubscriptionProtocol(req.subscriptionProtocol)
              : undefined,
            updatedBy: authContext.userId,
            readme: req.readme,
            namespaceId: subgraph.namespaceId,
          },
          opts.blobStorage,
          {
            cdnBaseUrl: opts.cdnBaseUrl,
            webhookJWTSecret: opts.admissionWebhookJWTSecret,
          },
        );

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'subgraph.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'subgraph',
          auditableDisplayName: subgraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });

        for (const graph of updatedFederatedGraphs) {
          orgWebhooks.send({
            eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
            payload: {
              federated_graph: {
                id: graph.id,
                name: graph.name,
                namespace: graph.namespace,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              errors: compositionErrors.length > 0 || deploymentErrors.length > 0,
              actor_id: authContext.userId,
            },
          });
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
            deploymentErrors: [],
          };
        }

        if (deploymentErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_DEPLOYMENT_FAILED,
            },
            compositionErrors: [],
            deploymentErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          deploymentErrors: [],
        };
      });
    },

    checkFederatedGraph: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CheckFederatedGraphResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
            subgraphs: [],
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace, {
          supportsFederation: true,
        });
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
            compositionErrors: [],
            subgraphs: [],
          };
        }

        if (!isValidLabelMatchers(req.labelMatchers)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One or more labels in the matcher were found to be invalid`,
            },
            compositionErrors: [],
            subgraphs: [],
          };
        }

        const subgraphs = await subgraphRepo.byGraphLabelMatchers({
          labelMatchers: req.labelMatchers,
          namespaceId: federatedGraph.namespaceId,
        });

        const subgraphsDetails = subgraphs.map((s) => ({
          id: s.id,
          name: s.name,
          routingURL: s.routingUrl,
          labels: s.labels,
          lastUpdatedAt: s.lastUpdatedAt,
          targetId: s.targetId,
          subscriptionUrl: s.subscriptionUrl,
          namespace: s.namespace,
        }));

        const result = composeSubgraphs(
          subgraphs.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.routingUrl,
            definitions: parse(s.schemaSDL),
          })),
        );

        if (result.errors) {
          const compositionErrors: PlainMessage<CompositionError>[] = [];
          for (const error of result.errors) {
            compositionErrors.push({
              message: error.message,
              federatedGraphName: req.name,
              namespace: federatedGraph.namespace,
            });
          }

          if (compositionErrors.length > 0) {
            return {
              response: {
                code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
              },
              compositionErrors,
              subgraphs: subgraphsDetails,
            };
          }
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
          subgraphs: subgraphsDetails,
        };
      });
    },

    createFederatedGraphToken: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateFederatedGraphTokenResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            token: '',
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.graphName}' not found`,
            },
            token: '',
          };
        }

        const currToken = await fedGraphRepo.getRouterToken({
          federatedGraphId: graph.id,
          organizationId: authContext.organizationId,
          tokenName: req.tokenName,
        });
        if (currToken) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Router token '${req.tokenName}' already exists`,
            },
            token: '',
          };
        }

        const tokenValue = await signJwtHS256<GraphApiKeyJwtPayload>({
          secret: opts.jwtSecret,
          token: {
            iss: authContext.userId,
            federated_graph_id: graph.id,
            aud: audiences.cosmoGraphKey, // to distinguish from other tokens
            organization_id: authContext.organizationId,
          },
        });

        const token = await fedGraphRepo.createToken({
          token: tokenValue,
          federatedGraphId: graph.id,
          tokenName: req.tokenName,
          createdBy: authContext.userId,
          organizationId: authContext.organizationId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'graph_token.created',
          action: 'created',
          actorId: authContext.userId,
          targetId: graph.id,
          targetDisplayName: graph.name,
          targetType: 'federated_graph',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          auditableDisplayName: token.name,
          auditableType: 'graph_token',
          targetNamespaceId: graph.namespaceId,
          targetNamespaceDisplayName: graph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          token: token.token,
        };
      });
    },

    inviteUser: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<InviteUserResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const userRepo = new UserRepository(opts.db);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const organization = await orgRepo.byId(authContext.organizationId);
        if (!organization) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const memberCount = await orgRepo.memberCount(authContext.organizationId);

        const usersFeature = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'users',
        });

        const limit = usersFeature?.limit === -1 ? undefined : usersFeature?.limit;

        if (limit && memberCount >= limit) {
          return {
            response: {
              code: EnumStatusCode.ERR_LIMIT_REACHED,
              details: `The user limit for this organization has been reached`,
            },
          };
        }

        await opts.keycloakClient.authenticateClient();

        const user = await userRepo.byEmail(req.email);
        if (user) {
          const orgMember = await orgRepo.getOrganizationMember({
            organizationID: authContext.organizationId,
            userID: user.id,
          });
          if (orgMember) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `${req.email} is already a member of this organization`,
              },
            };
          }

          const orgInvitation = await orgInvitationRepo.getPendingOrganizationInvitation({
            organizationID: authContext.organizationId,
            userID: user.id,
          });
          if (orgInvitation) {
            const userMemberships = await orgRepo.memberships({ userId: user.id });
            // if the user memberships are empty, that means the user has not logged in till now,
            // so we send the user a mail form keycloak
            if (userMemberships.length === 0) {
              await opts.keycloakClient.executeActionsEmail({
                userID: user.id,
                redirectURI: `${process.env.WEB_BASE_URL}/login?redirectURL=${process.env.WEB_BASE_URL}/account/invitations`,
                realm: opts.keycloakRealm,
              });
            } else {
              // the user has already logged in, so we send our custom org invitation email
              // eslint-disable-next-line no-lonely-if
              if (opts.mailerClient) {
                await opts.mailerClient.sendInviteEmail({
                  inviteLink: `${process.env.WEB_BASE_URL}/account/invitations`,
                  organizationName: organization.name,
                  receiverEmail: req.email,
                  invitedBy: orgInvitation.invitedBy,
                });
              }
            }

            await auditLogRepo.addAuditLog({
              organizationId: authContext.organizationId,
              auditAction: 'organization_invitation.created',
              action: 'created',
              actorId: authContext.userId,
              auditableDisplayName: req.email,
              auditableType: 'user',
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            });

            return {
              response: {
                code: EnumStatusCode.OK,
                details: 'Invited member successfully.',
              },
            };
          }
        }

        const keycloakUser = await opts.keycloakClient.client.users.find({
          max: 1,
          email: req.email,
          realm: opts.keycloakRealm,
          exact: true,
        });

        let keycloakUserID;

        if (keycloakUser.length === 0) {
          keycloakUserID = await opts.keycloakClient.addKeycloakUser({
            email: req.email,
            isPasswordTemp: true,
            realm: opts.keycloakRealm,
          });
        } else {
          keycloakUserID = keycloakUser[0].id;
        }

        const userMemberships = await orgRepo.memberships({ userId: keycloakUserID! });
        // to verify if the user is a new user or not, we check the memberships of the user
        if (userMemberships.length > 0) {
          if (opts.mailerClient) {
            const inviter = await userRepo.byId(authContext.userId);
            await opts.mailerClient.sendInviteEmail({
              inviteLink: `${process.env.WEB_BASE_URL}/account/invitations`,
              organizationName: organization.name,
              receiverEmail: req.email,
              invitedBy: inviter?.email,
            });
          }
        } else {
          await opts.keycloakClient.executeActionsEmail({
            userID: keycloakUserID!,
            redirectURI: `${process.env.WEB_BASE_URL}/login?redirectURL=${process.env.WEB_BASE_URL}/account/invitations`,
            realm: opts.keycloakRealm,
          });
        }

        // TODO: rate limit this
        await orgInvitationRepo.inviteUser({
          email: req.email,
          userId: keycloakUserID!,
          organizationId: authContext.organizationId,
          dbUser: user,
          inviterUserId: authContext.userId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'organization_invitation.created',
          action: 'created',
          actorId: authContext.userId,
          auditableDisplayName: req.email,
          auditableType: 'user',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
            details: 'Invited member successfully.',
          },
        };
      });
    },

    createAPIKey: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateAPIKeyResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const apiKeyRepo = new ApiKeyRepository(opts.db);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            apiKey: '',
          };
        }

        const keyName = req.name.trim();

        const apiKeyModel = await apiKeyRepo.getAPIKeyByName({
          organizationID: authContext.organizationId,
          name: keyName,
        });
        if (apiKeyModel) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `An API key with the name ${req.name} already exists`,
            },
            apiKey: '',
          };
        }

        if (keyName.length < 3 || keyName.length > 50) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `An API key name ${req.name} does not follow the required naming rules`,
            },
            apiKey: '',
          };
        }

        const generatedAPIKey = ApiKeyGenerator.generate();

        // check if the user is authorized to perform the action
        for (const targetId of req.federatedGraphTargetIds) {
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId,
              targetType: 'federatedGraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });
        }

        for (const targetId of req.subgraphTargetIds) {
          await opts.authorizer.authorize({
            db: opts.db,
            graph: {
              targetId,
              targetType: 'subgraph',
            },
            headers: ctx.requestHeader,
            authContext,
          });
        }

        await apiKeyRepo.addAPIKey({
          name: keyName,
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
          key: generatedAPIKey,
          expiresAt: req.expires,
          targetIds: [...req.federatedGraphTargetIds, ...req.subgraphTargetIds],
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'api_key.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'api_key',
          auditableDisplayName: keyName,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          apiKey: generatedAPIKey,
        };
      });
    },

    deleteAPIKey: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteAPIKeyResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const apiKeyRepo = new ApiKeyRepository(opts.db);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const apiKey = await apiKeyRepo.getAPIKeyByName({ organizationID: authContext.organizationId, name: req.name });
        if (!apiKey) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `An API key with the name ${req.name} doesnt exists`,
            },
          };
        }

        const userRoles = await orgRepo.getOrganizationMemberRoles({
          userID: authContext.userId || '',
          organizationID: authContext.organizationId,
        });

        if (!(apiKey.creatorUserID === authContext.userId || userRoles.includes('admin'))) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `You are not authorized to delete the api key '${apiKey.name}'`,
            },
          };
        }

        await apiKeyRepo.removeAPIKey({
          name: req.name,
          organizationID: authContext.organizationId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'api_key.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'api_key',
          auditableDisplayName: apiKey.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeOrganizationMember: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<RemoveInvitationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);
        const userRepo = new UserRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const user = await userRepo.byEmail(req.email);
        if (!user) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `User ${req.email} not found`,
            },
          };
        }

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const orgMember = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: user.id,
        });
        if (!orgMember) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `User ${req.email} is not a part of this organization.`,
            },
          };
        }

        if (org.creatorUserId === user.id) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The creator of this organization ${req.email} cannot be removed from the organization.`,
            },
          };
        }

        await opts.keycloakClient.authenticateClient();

        await opts.keycloakClient.removeUserFromOrganization({
          realm: opts.keycloakRealm,
          userID: user.id,
          groupName: org.slug,
          roles: orgMember.roles,
        });

        await orgRepo.removeOrganizationMember({ organizationID: authContext.organizationId, userID: user.id });

        const userMemberships = await orgRepo.memberships({ userId: user.id });

        // delete the user only when user doesn't have any memberships
        // this will happen only when the user was invited but the user didn't login and the admin removed that user,
        // in this case the user will not have a personal org
        if (userMemberships.length === 0) {
          // deleting the user from keycloak
          await opts.keycloakClient.client.users.del({
            id: user.id,
            realm: opts.keycloakRealm,
          });
          // deleting the user from the db
          await userRepo.deleteUser({ id: user.id });
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'organization_member.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableDisplayName: req.email,
          auditableType: 'user',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeInvitation: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<RemoveInvitationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const userRepo = new UserRepository(opts.db);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const user = await userRepo.byEmail(req.email);
        if (!user) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `User ${req.email} not found`,
            },
          };
        }

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const orgInvitation = await orgInvitationRepo.getPendingOrganizationInvitation({
          organizationID: authContext.organizationId,
          userID: user.id,
        });
        if (!orgInvitation) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Invite to the user ${req.email} does not exist.`,
            },
          };
        }

        await orgInvitationRepo.removeInvite({
          organizationId: authContext.organizationId,
          userId: user.id,
        });

        const userMemberships = await orgRepo.memberships({ userId: user.id });
        const userPendingInvitations = await orgInvitationRepo.getPendingInvitationsOfUser({ userId: user.id });

        // delete the user only when user doesn't have any memberships and pending invitations
        // this will happen only when the user was invited but the user didn't login and the admin removed that user,
        // in this case the user will not have a personal org
        if (userMemberships.length === 0 && userPendingInvitations.length === 0) {
          // deleting the user from keycloak
          await opts.keycloakClient.client.users.del({
            id: user.id,
            realm: opts.keycloakRealm,
          });
          // deleting the user from the db
          await userRepo.deleteUser({ id: user.id });
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'organization_invitation.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableDisplayName: user.email,
          auditableType: 'user',
          actorDisplayName: authContext.userDisplayName,
          targetDisplayName: org.name,
          targetType: 'organization',
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    migrateFromApollo: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<MigrateFromApolloResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const userRepo = new UserRepository(opts.db);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(
          opts.db,
          authContext.organizationId,
          opts.logger,
          opts.billingDefaultPlanId,
        );
        const auditLogRepo = new AuditLogRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            token: '',
          };
        }

        opts.platformWebhooks.send(PlatformEventName.APOLLO_MIGRATE_INIT, {
          actor_id: authContext.userId,
        });

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Could not find namespace ${req.namespace}`,
            },
            token: '',
          };
        }

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
            token: '',
          };
        }

        const user = await userRepo.byId(authContext.userId || '');

        const apolloMigrator = new ApolloMigrator({
          apiKey: req.apiKey,
          organizationSlug: org.slug,
          variantName: req.variantName,
          logger,
          userEmail: user?.email || '',
          userId: user?.id || '',
        });

        const graph = await apolloMigrator.fetchGraphID();
        if (!graph.success) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Could not fetch the graph from Apollo. Please ensure that the API Key is valid.`,
            },
            token: '',
          };
        }

        const graphDetails = await apolloMigrator.fetchGraphDetails({ graphID: graph.id });

        if (!graphDetails.success) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: graphDetails.errorMessage,
            },
            token: '',
          };
        }

        if (await fedGraphRepo.exists(graph.name, req.namespace)) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Federated graph '${graph.name}' already exists.`,
            },
            token: '',
          };
        }

        for await (const subgraph of graphDetails.subgraphs) {
          if (await subgraphRepo.exists(subgraph.name, req.namespace)) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `Subgraph '${subgraph.name}' already exists`,
              },
              token: '',
            };
          }
        }

        await opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(logger, tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(logger, tx, authContext.organizationId);
          const composer = new Composer(logger, fedGraphRepo, subgraphRepo);

          const federatedGraph = await apolloMigrator.migrateGraphFromApollo({
            fedGraph: {
              name: graph.name,
              routingURL: graphDetails.fedGraphRoutingURL || '',
            },
            subgraphs: graphDetails.subgraphs,
            organizationID: authContext.organizationId,
            db: tx,
            creatorUserId: authContext.userId,
            namespace: req.namespace,
            namespaceId: namespace.id,
          });

          const composition = await composer.composeFederatedGraph(federatedGraph);

          await composer.deployComposition({
            composedGraph: composition,
            composedBy: authContext.userId,
            blobStorage: opts.blobStorage,
            organizationId: authContext.organizationId,
            admissionWebhookURL: federatedGraph.admissionWebhookURL,
            admissionConfig: {
              cdnBaseUrl: opts.cdnBaseUrl,
              jwtSecret: opts.admissionWebhookJWTSecret,
            },
          });
        });

        const migratedGraph = await fedGraphRepo.byName(graph.name, req.namespace);
        if (!migratedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Could not complete the migration. Please try again.',
            },
            token: '',
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'federated_graph.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'federated_graph',
          auditableDisplayName: migratedGraph.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: migratedGraph.namespaceId,
          targetNamespaceDisplayName: migratedGraph.namespace,
        });

        const subgraphs = await subgraphRepo.byGraphLabelMatchers({
          labelMatchers: migratedGraph.labelMatchers,
          namespaceId: migratedGraph.namespaceId,
        });
        for (const subgraph of subgraphs) {
          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'subgraph.created',
            action: 'created',
            actorId: authContext.userId,
            auditableType: 'subgraph',
            auditableDisplayName: subgraph.name,
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            targetNamespaceId: subgraph.namespaceId,
            targetNamespaceDisplayName: subgraph.namespace,
          });
        }

        orgWebhooks.send({
          eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
          payload: {
            federated_graph: {
              id: migratedGraph.id,
              name: migratedGraph.name,
              namespace: migratedGraph.namespace,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: false,
            actor_id: authContext.userId,
          },
        });

        const tokenValue = await signJwtHS256<GraphApiKeyJwtPayload>({
          secret: opts.jwtSecret,
          token: {
            iss: authContext.userId,
            federated_graph_id: migratedGraph.id,
            aud: audiences.cosmoGraphKey, // to distinguish from other tokens
            organization_id: authContext.organizationId,
          },
        });

        const token = await fedGraphRepo.createToken({
          token: tokenValue,
          federatedGraphId: migratedGraph.id,
          tokenName: migratedGraph.name,
          organizationId: authContext.organizationId,
          createdBy: authContext.userId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'graph_token.created',
          action: 'created',
          actorId: authContext.userId,
          targetId: migratedGraph.id,
          targetDisplayName: migratedGraph.name,
          targetType: 'federated_graph',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          auditableDisplayName: token.name,
          auditableType: 'graph_token',
          targetNamespaceId: migratedGraph.namespaceId,
          targetNamespaceDisplayName: migratedGraph.namespace,
        });

        opts.platformWebhooks.send(PlatformEventName.APOLLO_MIGRATE_SUCCESS, {
          federated_graph: {
            id: migratedGraph.id,
            name: migratedGraph.name,
          },
          actor_id: authContext.userId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          token: token.token,
        };
      });
    },

    createOrganizationWebhookConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateOrganizationWebhookConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await orgRepo.createWebhookConfig({
          organizationId: authContext.organizationId,
          ...req,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'webhook_config.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'webhook_config',
          auditableDisplayName: req.endpoint,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateOrganizationWebhookConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await orgRepo.updateWebhookConfig({
          organizationId: authContext.organizationId,
          ...req,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'webhook_config.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'webhook_config',
          auditableDisplayName: req.endpoint,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteOrganizationWebhookConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const config = await orgRepo.deleteWebhookConfig({
          organizationId: authContext.organizationId,
          ...req,
        });

        if (!config) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Webhook config could not be deleted`,
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'webhook_config.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'webhook_config',
          auditableDisplayName: config.endpoint || '',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteOrganization: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteOrganizationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const memberships = await orgRepo.memberships({ userId: authContext.userId });
        const orgCount = memberships.length;

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const user = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
        });

        if (!user) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User is not a part of this organization.',
            },
          };
        }

        // non admins cannot delete the organization
        if (!user.roles.includes('admin')) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not have the permissions to delete the organization.',
            },
          };
        }

        // Minimum one organization is required for a user
        if (orgCount <= 1) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Minimum one organization is required for a user.',
            },
          };
        }

        await opts.keycloakClient.authenticateClient();

        const organizationGroup = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: org.slug,
          realm: opts.keycloakRealm,
        });

        if (organizationGroup.length === 0) {
          throw new Error(`Organization group '${org.slug}' not found`);
        }

        await opts.keycloakClient.client.groups.del({
          id: organizationGroup[0].id!,
          realm: opts.keycloakRealm,
        });

        return opts.db.transaction(async (tx) => {
          const orgRepo = new OrganizationRepository(logger, tx, opts.billingDefaultPlanId);
          const billingRepo = new BillingRepository(tx);
          const billingService = new BillingService(tx, billingRepo);

          const subscription = await billingRepo.getActiveSubscriptionOfOrganization(authContext.organizationId);
          if (subscription) {
            await billingService.cancelSubscription(authContext.organizationId, subscription.id, 'Deleted by api');
          }
          await orgRepo.deleteOrganization(authContext.organizationId);

          return {
            response: {
              code: EnumStatusCode.OK,
            },
          };
        });
      });
    },

    leaveOrganization: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<LeaveOrganizationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const orgMember = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
        });

        if (!orgMember) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User is not a part of this organization.',
            },
          };
        }

        // the creator of the personal org cannot leave the organization.
        if (org.creatorUserId === (authContext.userId || req.userID)) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Creator of a organization cannot leave the organization.`,
            },
          };
        }

        // checking if the user is a single admin
        if (orgMember.roles.includes('admin')) {
          const orgAdmins = await orgRepo.getOrganizationAdmins({ organizationID: authContext.organizationId });
          if (orgAdmins.length === 1) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details:
                  'Single admins cannot leave the organization. Please make another member an admin and try again.',
              },
            };
          }
        }

        await opts.keycloakClient.authenticateClient();

        const organizationGroup = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: org.slug,
          realm: opts.keycloakRealm,
        });

        if (organizationGroup.length === 0) {
          throw new Error(`Organization group '${org.slug}' not found`);
        }

        // removing the group from the keycloak user
        await opts.keycloakClient.client.users.delFromGroup({
          id: orgMember.userID,
          groupId: organizationGroup[0].id!,
          realm: opts.keycloakRealm,
        });

        // removing the user for the organization in the db
        await orgRepo.removeOrganizationMember({
          userID: authContext.userId || req.userID,
          organizationID: authContext.organizationId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'organization.left',
          action: 'left',
          actorId: authContext.userId,
          auditableType: 'organization',
          auditableDisplayName: org.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateOrganizationDetails: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateOrganizationDetailsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const orgMember = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
        });

        if (!orgMember) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User is not a part of this organization.',
            },
          };
        }

        // non admins cannot update the organization name
        if (!orgMember.roles.includes('admin')) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not have the permissions to update the organization name.',
            },
          };
        }

        if (!isValidOrganizationSlug(req.organizationSlug)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details:
                'Invalid slug. It must be of 3-24 characters in length, start and end with an alphanumeric character and may contain hyphens in between.',
            },
          };
        }

        if (!isValidOrganizationName(req.organizationName)) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid name. It must be of 1-24 characters in length.',
            },
          };
        }

        if (org.slug !== req.organizationSlug) {
          // checking if the provided orgSlug is available
          const newOrg = await orgRepo.bySlug(req.organizationSlug);
          if (newOrg) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `Organization with slug ${req.organizationSlug} already exists.`,
              },
            };
          }

          await opts.keycloakClient.authenticateClient();

          const organizationGroup = await opts.keycloakClient.client.groups.find({
            max: 1,
            search: org.slug,
            realm: opts.keycloakRealm,
          });

          if (organizationGroup.length === 0) {
            throw new Error(`Organization group '${org.slug}' not found`);
          }

          await opts.keycloakClient.client.groups.update(
            {
              id: organizationGroup[0].id!,
              realm: opts.keycloakRealm,
            },
            { name: req.organizationSlug },
          );
        }

        await orgRepo.updateOrganization({
          id: authContext.organizationId,
          name: req.organizationName,
          slug: req.organizationSlug,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'organization_details.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'organization',
          auditableDisplayName: org.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateOrgMemberRole: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateOrgMemberRoleResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const oidcRepo = new OidcRepository(opts.db);
        const auditLogRepo = new AuditLogRepository(opts.db);

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        // fetching the user who is updating the other member's role.
        const user = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
        });

        if (!user) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User is not a part of this organization.',
            },
          };
        }

        // non admins cannot update the role of an org member
        if (!user.roles.includes('admin')) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not have the permissions to the role of an organization member.',
            },
          };
        }

        // fetching the user whose role is being updated.
        const orgMember = await orgRepo.getOrganizationMember({
          organizationID: authContext.organizationId,
          userID: req.orgMemberUserID,
        });

        if (!orgMember) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User is not a part of this organization.',
            },
          };
        }

        await opts.keycloakClient.authenticateClient();

        const users = await opts.keycloakClient.client.users.find({
          realm: opts.keycloakRealm,
          email: orgMember.email,
          exact: true,
        });

        if (users.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not exist.',
            },
          };
        }

        const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });

        if (provider) {
          // checking if the user has logged in using the sso
          const ssoUser = await opts.keycloakClient.client.users.find({
            realm: opts.keycloakRealm,
            email: orgMember.email,
            exact: true,
            idpAlias: provider.alias,
          });

          if (ssoUser.length > 0) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: 'User has logged in using the OIDC provider. Please update the role using the provider.',
              },
            };
          }
        }

        const organizationGroups = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: org.slug,
          realm: opts.keycloakRealm,
          briefRepresentation: false,
        });

        if (organizationGroups.length === 0) {
          throw new Error(`Organization group '${org.slug}' not found`);
        }

        const userRoles = await orgRepo.getOrganizationMemberRoles({
          userID: orgMember.userID,
          organizationID: authContext.organizationId,
        });
        const highPriorityRole = getHighestPriorityRole({ userRoles });

        const adminChildGroup = await opts.keycloakClient.fetchChildGroup({
          realm: opts.keycloakRealm,
          orgSlug: org.slug,
          kcGroupId: organizationGroups[0].id!,
          childGroupType: 'admin',
        });

        const devChildGroup = await opts.keycloakClient.fetchChildGroup({
          realm: opts.keycloakRealm,
          orgSlug: org.slug,
          kcGroupId: organizationGroups[0].id!,
          childGroupType: 'developer',
        });

        const viewerChildGroup = await opts.keycloakClient.fetchChildGroup({
          realm: opts.keycloakRealm,
          orgSlug: org.slug,
          kcGroupId: organizationGroups[0].id!,
          childGroupType: 'viewer',
        });

        if (req.role === 'admin') {
          if (highPriorityRole === 'developer') {
            await opts.keycloakClient.client.users.delFromGroup({
              id: users[0].id!,
              realm: opts.keycloakRealm,
              groupId: devChildGroup.id!,
            });
          } else if (highPriorityRole === 'viewer') {
            await opts.keycloakClient.client.users.delFromGroup({
              id: users[0].id!,
              realm: opts.keycloakRealm,
              groupId: viewerChildGroup.id!,
            });
          }
          await opts.keycloakClient.client.users.addToGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: adminChildGroup.id!,
          });

          await orgRepo.updateUserRole({
            organizationID: authContext.organizationId,
            orgMemberID: orgMember.orgMemberID,
            role: 'admin',
            previousRole: highPriorityRole,
          });

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'member_role.updated',
            action: 'updated',
            actorId: authContext.userId,
            auditableDisplayName: 'admin',
            auditableType: 'member_role',
            actorDisplayName: authContext.userDisplayName,
            targetId: orgMember.userID,
            targetDisplayName: orgMember.email,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          });
        } else {
          await opts.keycloakClient.client.users.addToGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: devChildGroup.id!,
          });

          await opts.keycloakClient.client.users.delFromGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: adminChildGroup.id!,
          });

          const role = 'developer';

          await orgRepo.updateUserRole({
            organizationID: authContext.organizationId,
            orgMemberID: orgMember.orgMemberID,
            role,
            previousRole: 'admin',
          });

          await auditLogRepo.addAuditLog({
            organizationId: authContext.organizationId,
            auditAction: 'member_role.updated',
            action: 'updated',
            actorId: authContext.userId,
            auditableDisplayName: role,
            auditableType: 'member_role',
            actorDisplayName: authContext.userDisplayName,
            targetId: orgMember.userID,
            targetType: 'user',
            targetDisplayName: orgMember.email,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          });
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteRouterToken: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteRouterTokenResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.fedGraphName, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' not found`,
            },
          };
        }

        const currToken = await fedGraphRepo.getRouterToken({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
          tokenName: req.tokenName,
        });

        if (!currToken) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Router token '${req.tokenName}' doesn't exist`,
            },
            token: '',
          };
        }

        await fedGraphRepo.deleteToken({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
          tokenName: req.tokenName,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'graph_token.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          targetId: federatedGraph.id,
          targetDisplayName: federatedGraph.name,
          targetType: 'federated_graph',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          auditableDisplayName: currToken.name,
          auditableType: 'graph_token',
          targetNamespaceId: federatedGraph.namespaceId,
          targetNamespaceDisplayName: federatedGraph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createIntegration: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateIntegrationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        if (!opts.slack || !opts.slack.clientID || !opts.slack.clientSecret) {
          throw new Error('Slack env variables must be set to use this feature.');
        }

        const integration = await orgRepo.getIntegrationByName(authContext.organizationId, req.name);
        if (integration) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Integration with name ${req.name} already exists`,
            },
          };
        }

        const slack = new Slack({ clientID: opts.slack.clientID, clientSecret: opts.slack.clientSecret });

        const accessTokenResp = await slack.fetchAccessToken(
          req.code,
          `${opts.webBaseUrl}/${authContext.organizationSlug}/integrations`,
        );
        if (!accessTokenResp) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Could not set up the integration. Please try again.',
            },
          };
        }

        await slack.addSlackInstallations({
          accessToken: accessTokenResp.accessToken,
          db: opts.db,
          organizationId: authContext.organizationId,
          slackChannelId: accessTokenResp.slackChannelId,
          slackChannelName: accessTokenResp.slackChannelName,
          slackOrganizationId: accessTokenResp.slackOrgId,
          slackOrganizationName: accessTokenResp.slackOrgName,
          slackUserId: accessTokenResp.slackUserId,
        });

        await orgRepo.createIntegration({
          organizationId: authContext.organizationId,
          endpoint: accessTokenResp.webhookURL,
          events: req.events,
          eventsMeta: req.eventsMeta,
          name: req.name,
          type: req.type,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'integration.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'integration',
          auditableDisplayName: req.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateIntegrationConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateIntegrationConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const integration = await orgRepo.getIntegration(req.id, authContext.organizationId);
        if (!integration) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Integration with id ${req.id} not found`,
            },
          };
        }

        const updatedIntegration = await orgRepo.updateIntegrationConfig({
          organizationId: authContext.organizationId,
          ...req,
        });

        if (!updatedIntegration) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Could not update configuration.`,
            },
          };
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'integration.updated',
          action: 'updated',
          actorId: authContext.userId,
          auditableType: 'integration',
          auditableDisplayName: integration.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteIntegration: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteIntegrationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const integration = await orgRepo.getIntegration(req.id, authContext.organizationId);
        if (!integration) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Integration with id ${req.id} not found`,
            },
          };
        }

        await orgRepo.deleteIntegration({
          organizationId: authContext.organizationId,
          id: req.id,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'integration.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'integration',
          auditableDisplayName: integration.name,
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createOIDCProvider: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateOIDCProviderResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const oidcProvider = new OidcProvider();

        if (!authContext.isAdmin) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            signInURL: '',
            signOutURL: '',
            loginURL: '',
          };
        }

        await opts.keycloakClient.authenticateClient();

        const alias = `${authContext.organizationSlug}_${uid(3)}`;

        await oidcProvider.createOidcProvider({
          kcClient: opts.keycloakClient,
          kcRealm: opts.keycloakRealm,
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          alias,
          db: opts.db,
          input: req,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          signInURL: `${opts.keycloakApiUrl}/realms/${opts.keycloakRealm}/broker/${alias}/endpoint`,
          signOutURL: `${opts.keycloakApiUrl}/realms/${opts.keycloakRealm}/broker/${alias}/endpoint/logout_response`,
          loginURL: `${opts.webBaseUrl}/login?sso=${alias}`,
        };
      });
    },

    deleteOIDCProvider: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteOIDCProviderResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const oidcRepo = new OidcRepository(opts.db);
        const oidcProvider = new OidcProvider();

        if (!authContext.isAdmin) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await opts.keycloakClient.authenticateClient();

        const organization = await orgRepo.byId(authContext.organizationId);
        if (!organization) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
        if (!provider) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization ${authContext.organizationSlug} doesn't have an oidc identity provider `,
            },
          };
        }

        await oidcProvider.deleteOidcProvider({
          kcClient: opts.keycloakClient,
          kcRealm: opts.keycloakRealm,
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          orgCreatorUserId: organization.creatorUserId,
          alias: provider.alias,
          db: opts.db,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    publishPersistedOperations: (req, ctx) => {
      /**
       * Receives a federated graph name and a list of persisted operation contents.
       * First, it validates that the graph exists and all the operations are valid,
       * then it stores them. Additionally, if the provided client name for registering
       * the operations has never been seen before, we create an entry in the database
       * with it.
       */
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<PublishPersistedOperationsResponse>>(ctx, logger, async () => {
        req.namespace = req.namespace || DefaultNamespace;

        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            operations: [],
          };
        }
        const userId = authContext.userId;
        if (!userId) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHENTICATED,
              details: `User not found in the authentication context`,
            },
            operations: [],
          };
        }
        const organizationId = authContext.organizationId;
        const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, organizationId);

        // Validate everything before we update any data
        const federatedGraph = await federatedGraphRepo.byName(req.fedGraphName, req.namespace);
        if (federatedGraph === undefined) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' does not exist`,
            },
            operations: [],
          };
        }

        const schema = await federatedGraphRepo.getLatestValidSchemaVersion({
          targetId: federatedGraph.targetId,
        });
        if (!schema?.schema) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Schema for '${req.fedGraphName}' does not exist`,
            },
            operations: [],
          };
        }
        const graphAST = parse(schema.schema);
        const graphSchema = buildASTSchema(graphAST);
        for (const operation of req.operations) {
          const contents = operation.contents;
          let opAST: DocumentNode;
          try {
            opAST = parse(operation.contents);
          } catch (e: any) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Operation ${operation.id} (${contents}) is not valid: ${e}`,
              },
              operations: [],
            };
          }
          const errors = validate(graphSchema, opAST, undefined, { maxErrors: 1 });
          if (errors.length > 0) {
            const errorDetails = errors.map((e) => `${e.toString()}`).join(', ');
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Operation ${operation.id} ("${contents}") is not valid: ${errorDetails}`,
              },
              operations: [],
            };
          }
        }
        const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
        let clientId: string;
        try {
          clientId = await operationsRepo.registerClient(req.clientName, userId);
        } catch (e: any) {
          const message = e instanceof Error ? e.message : e.toString();
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Could not register client "${req.clientName}": ${message}`,
            },
            operations: [],
          };
        }
        const operations: PublishedOperation[] = [];
        const updatedOperations: UpdatedPersistedOperation[] = [];
        // Retrieve the operations that have already been published
        const operationsResult = await operationsRepo.getPersistedOperations(clientId);
        const operationsByOperationId = new Map(
          operationsResult.map((op) => [op.operationId, { hash: op.hash, operationNames: op.operationNames }]),
        );
        for (const operation of req.operations) {
          const operationId = operation.id;
          const operationHash = crypto.createHash('sha256').update(operation.contents).digest('hex');
          const prev = operationsByOperationId.get(operationId);
          if (prev !== undefined && prev.hash !== operationHash) {
            // We're trying to update an operation with the same ID but different hash
            operations.push(
              new PublishedOperation({
                id: operationId,
                hash: prev.hash,
                status: PublishedOperationStatus.CONFLICT,
                operationNames: prev.operationNames,
              }),
            );
            continue;
          }
          const operationNames = extractOperationNames(operation.contents);
          operationsByOperationId.set(operationId, { hash: operationHash, operationNames });
          const path = `${organizationId}/${federatedGraph.id}/operations/${req.clientName}/${operationId}.json`;
          updatedOperations.push({
            operationId,
            hash: operationHash,
            filePath: path,
            contents: operation.contents,
            operationNames,
          });

          // New operation
          let status: PublishedOperationStatus;
          if (prev === undefined) {
            const data: PublishedOperationData = {
              version: 1,
              body: operation.contents,
            };
            try {
              await opts.blobStorage.putObject({
                key: path,
                body: Buffer.from(JSON.stringify(data), 'utf8'),
                contentType: 'application/json; charset=utf-8',
              });
            } catch (e) {
              logger.error(e, `Could not store operation contents for ${operationId} at ${path}`);
              return {
                response: {
                  code: EnumStatusCode.ERR,
                  details: `Could not store operation contents for ${operationId} at ${path}`,
                },
                operations: [],
              };
            }

            status = PublishedOperationStatus.CREATED;
          } else {
            status = PublishedOperationStatus.UP_TO_DATE;
          }
          operations.push(
            new PublishedOperation({
              id: operationId,
              hash: operationHash,
              status,
              operationNames,
            }),
          );
        }

        await operationsRepo.updatePersistedOperations(clientId, userId, updatedOperations);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          operations,
        };
      });
    },

    acceptOrDeclineInvitation: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<AcceptOrDeclineInvitationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const userRepo = new UserRepository(opts.db);
        const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        const user = await userRepo.byId(authContext.userId);
        if (!user) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `User ${authContext.userId} not found`,
            },
          };
        }

        const organization = await orgRepo.byId(req.organizationId);
        if (!organization) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization ${req.organizationId} not found`,
            },
          };
        }

        if (req.accept) {
          const groupName = organization.slug;

          await opts.keycloakClient.authenticateClient();

          const organizationGroups = await opts.keycloakClient.client.groups.find({
            max: 1,
            search: groupName,
            realm: opts.keycloakRealm,
          });

          if (organizationGroups.length === 0) {
            throw new Error(`Organization group '${groupName}' not found`);
          }

          const devGroup = await opts.keycloakClient.fetchChildGroup({
            realm: opts.keycloakRealm,
            kcGroupId: organizationGroups[0].id!,
            orgSlug: groupName,
            childGroupType: 'developer',
          });

          const keycloakUser = await opts.keycloakClient.client.users.find({
            max: 1,
            email: user.email,
            realm: opts.keycloakRealm,
            exact: true,
          });

          if (keycloakUser.length === 0) {
            throw new Error(`Keycloak user with email '${user.email}' not found`);
          }

          await opts.keycloakClient.client.users.addToGroup({
            id: keycloakUser[0].id!,
            groupId: devGroup.id!,
            realm: opts.keycloakRealm,
          });

          await orgInvitationRepo.acceptInvite({ userId: user.id, organizationId: req.organizationId });

          await auditLogRepo.addAuditLog({
            organizationId: req.organizationId,
            auditAction: 'organization.joined',
            action: 'joined',
            actorId: authContext.userId,
            auditableDisplayName: organization.name,
            auditableType: 'organization',
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          });
        } else {
          await orgInvitationRepo.removeInvite({ organizationId: req.organizationId, userId: user.id });

          await auditLogRepo.addAuditLog({
            organizationId: req.organizationId,
            auditAction: 'organization_invitation.declined',
            action: 'deleted',
            actorId: authContext.userId,
            auditableDisplayName: organization.name,
            auditableType: 'organization',
            actorDisplayName: authContext.userDisplayName,
            actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          });
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateFeatureSettings: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateFeatureSettingsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        if (!authContext.isAdmin) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        let featureId: FeatureIds;
        switch (req.featureId) {
          case Feature.rbac: {
            featureId = 'rbac';
            break;
          }
          case Feature.ai: {
            featureId = 'ai';
            break;
          }
          case Feature.scim: {
            featureId = 'scim';
            break;
          }
          default: {
            throw new Error(`Feature doesnt exist`);
          }
        }

        await orgRepo.updateFeature({
          organizationId: authContext.organizationId,
          id: featureId,
          enabled: req.enable,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    addSubgraphMember: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<AddSubgraphMemberResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const userRepo = new UserRepository(opts.db);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        // check if the user to be added exists and if the user is the member of the org
        const user = await userRepo.byEmail(req.userEmail);
        if (!user) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `User with email ${req.userEmail} not found`,
            },
          };
        }
        const isMember = await orgRepo.isMemberOf({ organizationId: authContext.organizationId, userId: user.id });
        if (!isMember) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `User with email ${req.userEmail} is not a member of the organization.`,
            },
          };
        }

        // check if the subgraph exists
        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph ${req.subgraphName} not found`,
            },
          };
        }

        // check if the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: subgraph.targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        await subgraphRepo.addSubgraphMember({ subgraphId: subgraph.id, userId: user.id });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'subgraph_member.created',
          action: 'created',
          actorId: authContext.userId,
          auditableType: 'user',
          auditableDisplayName: user.email,
          actorDisplayName: authContext.userDisplayName,
          targetDisplayName: subgraph.name,
          targetId: subgraph.id,
          targetType: 'subgraph',
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeSubgraphMember: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<RemoveSubgraphMemberResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        // check if the subgraph exists
        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph ${req.subgraphName} not found`,
            },
          };
        }

        // check if the user is authorized to perform the action
        await opts.authorizer.authorize({
          db: opts.db,
          graph: {
            targetId: subgraph.targetId,
            targetType: 'subgraph',
          },
          headers: ctx.requestHeader,
          authContext,
        });

        const member = (await subgraphRepo.getSubgraphMembers(subgraph.id)).find(
          (sm) => sm.subgraphMemberId === req.subgraphMemberId,
        );

        if (!member) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `The person is already not a member of the subgraph`,
            },
          };
        }

        await subgraphRepo.removeSubgraphMember({ subgraphId: subgraph.id, subgraphMemberId: req.subgraphMemberId });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'subgraph_member.deleted',
          action: 'deleted',
          actorId: authContext.userId,
          auditableType: 'user',
          auditableDisplayName: member.email,
          actorDisplayName: authContext.userDisplayName,
          targetDisplayName: subgraph.name,
          targetId: subgraph.id,
          targetType: 'subgraph',
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          targetNamespaceId: subgraph.namespaceId,
          targetNamespaceDisplayName: subgraph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    addReadme: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<AddReadmeResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const targetRepo = new TargetRepository(opts.db, authContext.organizationId);

        const target = await targetRepo.byName(req.targetName, req.namespace);
        if (!target) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Target ${req.targetName} not found in ${req.namespace} namespace`,
            },
          };
        }

        await targetRepo.updateReadmeOfTarget({ id: target.id, readme: req.readme });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    enableLintingForTheNamespace: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<EnableLintingForTheNamespaceResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Namespace '${req.namespace}' not found`,
            },
          };
        }

        await namespaceRepo.toggleEnableLinting({ name: req.namespace, enableLinting: req.enableLinting });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    configureNamespaceLintConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<ConfigureNamespaceLintConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const schemaLintRepo = new SchemaLintRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Namespace '${req.namespace}' not found`,
            },
            configs: [],
          };
        }

        await schemaLintRepo.configureNamespaceLintConfig({
          namespaceId: namespace.id,
          lintConfigs: req.configs,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    /*
    Queries
    */
    getSubgraphs: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSubgraphsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const repo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        // Namespace is optional, if not provided, we get all the subgraphs
        const namespace = await namespaceRepo.byName(req.namespace);

        const list: SubgraphDTO[] = await repo.list({
          limit: req.limit,
          offset: req.offset,
          namespaceId: namespace?.id,
        });

        return {
          graphs: list.map((g) => ({
            id: g.id,
            name: g.name,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            labels: g.labels,
            createdUserId: g.creatorUserId,
            targetId: g.targetId,
            subscriptionUrl: g.subscriptionUrl,
            namespace: g.namespace,
          })),
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getSubgraphByName: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSubgraphByNameResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        const subgraph = await subgraphRepo.byName(req.name, req.namespace);

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.name}' not found`,
            },
            members: [],
          };
        }

        return {
          graph: {
            id: subgraph.id,
            name: subgraph.name,
            lastUpdatedAt: subgraph.lastUpdatedAt,
            routingURL: subgraph.routingUrl,
            labels: subgraph.labels,
            targetId: subgraph.targetId,
            readme: subgraph.readme,
            subscriptionUrl: subgraph.subscriptionUrl,
            namespace: subgraph.namespace,
          },
          members: await subgraphRepo.getSubgraphMembers(subgraph.id),
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphs: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetFederatedGraphsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        // Namespace is optional, if not provided, we get all the federated graphs
        const namespace = await namespaceRepo.byName(req.namespace);

        const list: FederatedGraphDTO[] = await fedGraphRepo.list({
          limit: req.limit,
          offset: req.offset,
          namespaceId: namespace?.id,
          supportsFederation: req.supportsFederation,
        });

        const requestSeriesList: Record<string, PlainMessage<RequestSeriesItem>[]> = {};

        const { dateRange } = parseTimeFilters({
          start: subHours(new Date(), 4).toString(),
          end: new Date().toString(),
        });

        if (req.includeMetrics && opts.chClient) {
          const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);

          await Promise.all(
            list.map(async (g) => {
              const requestSeries = await analyticsDashRepo.getRequestSeries(g.id, authContext.organizationId, {
                granule: '5',
                dateRange,
              });
              requestSeriesList[g.id] = [];
              requestSeriesList[g.id].push(...requestSeries);
            }),
          );
        }

        return {
          graphs: list.map((g) => ({
            id: g.id,
            targetId: g.targetId,
            name: g.name,
            namespace: g.namespace,
            labelMatchers: g.labelMatchers,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            connectedSubgraphs: g.subgraphsCount,
            compositionErrors: g.compositionErrors ?? '',
            isComposable: g.isComposable,
            compositionId: g.compositionId,
            requestSeries: requestSeriesList[g.id] ?? [],
            supportsFederation: g.supportsFederation,
          })),
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphsBySubgraphLabels: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      req.namespace = req.namespace || DefaultNamespace;

      return handleError<PlainMessage<GetFederatedGraphsBySubgraphLabelsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            graphs: [],
          };
        }

        const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
          labels: subgraph.labels,
          namespaceId: subgraph.namespaceId,
        });

        return {
          graphs: federatedGraphs.map((g) => ({
            id: g.id,
            name: g.name,
            namespace: g.namespace,
            labelMatchers: g.labelMatchers,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            connectedSubgraphs: g.subgraphsCount,
            compositionErrors: g.compositionErrors ?? '',
            isComposable: g.isComposable,
            compositionId: g.compositionId,
            requestSeries: [],
            targetId: g.targetId,
            supportsFederation: g.supportsFederation,
          })),
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphSDLByName: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);
      return handleError<PlainMessage<GetFederatedGraphSDLByNameResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        const federatedGraph = await fedRepo.byName(req.name, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'The requested federated graph was not found',
            },
          };
        }
        const schemaVersion = await fedRepo.getLatestValidSchemaVersion({ targetId: federatedGraph.targetId });

        if (!schemaVersion || !schemaVersion.schema) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sdl: schemaVersion.schema,
          versionId: schemaVersion.schemaVersionId,
        };
      });
    },

    getSubgraphSDLFromLatestComposition: (req, ctx) => {
      req.namespace = req.namespace || DefaultNamespace;

      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSubgraphSDLFromLatestCompositionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const subgraph = await subgraphRepo.byName(req.name, req.namespace);
        const federatedGraph = await federatedGraphRepo.byName(req.fedGraphName, req.namespace);
        if (!subgraph || !federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        const schemaVersion = await subgraphRepo.getSDLFromLatestComposition({
          subgraphTargetId: subgraph.targetId,
          federatedGraphTargetId: federatedGraph.targetId,
        });
        if (!schemaVersion) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sdl: schemaVersion.schema || undefined,
          versionId: schemaVersion.schemaVersionId,
        };
      });
    },

    getLatestSubgraphSDL: (req, ctx) => {
      req.namespace = req.namespace || DefaultNamespace;

      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetLatestSubgraphSDLResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const subgraph = await subgraphRepo.byName(req.name, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sdl: subgraph.schemaSDL,
          versionId: subgraph.schemaVersionId,
        };
      });
    },

    getFederatedGraphByName: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetFederatedGraphByNameResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        const federatedGraph = await fedRepo.byName(req.name, req.namespace);

        if (!federatedGraph) {
          return {
            subgraphs: [],
            graphRequestToken: '',
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Graph '${req.name}' not found`,
            },
          };
        }

        let requestSeries: PlainMessage<RequestSeriesItem>[] = [];
        if (req.includeMetrics && opts.chClient) {
          const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
          requestSeries = await analyticsDashRepo.getWeeklyRequestSeries(federatedGraph.id, authContext.organizationId);
        }

        const list = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: federatedGraph.targetId,
          published: false,
        });

        const routerRequestToken = await fedRepo.getGraphSignedToken({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
        });

        if (!routerRequestToken) {
          return {
            subgraphs: [],
            graphRequestToken: '',
            response: {
              code: EnumStatusCode.ERR,
              details: 'Router Request token not found',
            },
          };
        }

        return {
          graph: {
            id: federatedGraph.id,
            targetId: federatedGraph.targetId,
            name: federatedGraph.name,
            namespace: federatedGraph.namespace,
            routingURL: federatedGraph.routingUrl,
            labelMatchers: federatedGraph.labelMatchers,
            lastUpdatedAt: federatedGraph.lastUpdatedAt,
            connectedSubgraphs: federatedGraph.subgraphsCount,
            compositionErrors: federatedGraph.compositionErrors ?? '',
            compositionId: federatedGraph.compositionId,
            isComposable: federatedGraph.isComposable,
            requestSeries,
            readme: federatedGraph.readme,
            supportsFederation: federatedGraph.supportsFederation,
          },
          subgraphs: list.map((g) => ({
            id: g.id,
            name: g.name,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            labels: g.labels,
            targetId: g.targetId,
            subscriptionUrl: g.subscriptionUrl,
            namespace: g.namespace,
          })),
          graphRequestToken: routerRequestToken,
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphChangelog: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetFederatedGraphChangelogResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedgraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        req.namespace = req.namespace || DefaultNamespace;

        const federatedGraph = await fedgraphRepo.byName(req.name, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
            federatedGraphChangelogOutput: [],
            hasNextPage: false,
          };
        }

        if (!req.pagination || !req.dateRange) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Please provide pagination and daterange',
            },
            federatedGraphChangelogOutput: [],
            hasNextPage: false,
          };
        }

        const changelogRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'changelog-retention',
        });

        const { dateRange } = validateDateRanges({
          limit: changelogRetention?.limit ?? 7,
          dateRange: req.dateRange,
        });

        if (!dateRange) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid date range',
            },
            federatedGraphChangelogOutput: [],
            hasNextPage: false,
          };
        }

        const result = await fedgraphRepo.fetchFederatedGraphChangelog(
          federatedGraph.targetId,
          req.pagination,
          dateRange,
        );

        if (!result) {
          return {
            federatedGraphChangelogOutput: [],
            hasNextPage: false,
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          federatedGraphChangelogOutput: result.federatedGraphChangelog,
          hasNextPage: result.hasNextPage,
        };
      });
    },

    getChecksByFederatedGraphName: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetChecksByFederatedGraphNameResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedgraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        req.namespace = req.namespace || DefaultNamespace;

        const federatedGraph = await fedgraphRepo.byName(req.name, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
            checks: [],
            checksCountBasedOnDateRange: 0,
            totalChecksCount: 0,
          };
        }

        const breakingChangeRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'breaking-change-retention',
        });

        const { dateRange } = validateDateRanges({
          limit: breakingChangeRetention?.limit ?? 7,
          dateRange: {
            start: req.startDate,
            end: req.endDate,
          },
        });

        if (!dateRange) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid date range',
            },
            checks: [],
            checksCountBasedOnDateRange: 0,
            totalChecksCount: 0,
          };
        }

        // check that the limit is less than the max option provided in the ui
        if (req.limit > 50) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid limit',
            },
            checks: [],
            checksCountBasedOnDateRange: 0,
            totalChecksCount: 0,
          };
        }

        const checksData = await subgraphRepo.checks({
          federatedGraphTargetId: federatedGraph.targetId,
          limit: req.limit,
          offset: req.offset,
          startDate: dateRange.start,
          endDate: dateRange.end,
        });
        const totalChecksCount = await subgraphRepo.getChecksCount({ federatedGraphTargetId: federatedGraph.targetId });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          checks: checksData.checks,
          checksCountBasedOnDateRange: checksData.checksCount,
          totalChecksCount,
        };
      });
    },

    getCheckSummary: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetCheckSummaryResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);
        const schemaLintRepo = new SchemaLintRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            compositionErrors: [],
            changes: [],
            affectedGraphs: [],
            trafficCheckDays: 0,
            lintIssues: [],
          };
        }

        const check = await subgraphRepo.checkById({ id: req.checkId, federatedGraphTargetId: graph.targetId });
        const checkDetails = await subgraphRepo.checkDetails(req.checkId, graph.targetId);

        if (!check || !checkDetails) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check not found',
            },
            compositionErrors: [],
            changes: [],
            affectedGraphs: [],
            trafficCheckDays: 0,
            lintIssues: [],
          };
        }

        const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

        const lintIssues = await schemaLintRepo.getSchemaCheckLintIsssues({ schemaCheckId: req.checkId });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          check,
          affectedGraphs: check.affectedGraphs,
          proposedSubgraphSchemaSDL: check.proposedSubgraphSchemaSDL,
          changes: checkDetails.changes,
          compositionErrors: checkDetails.compositionErrors,
          trafficCheckDays,
          lintIssues,
        };
      });
    },

    getCheckOperations: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetCheckOperationsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            operations: [],
            trafficCheckDays: 0,
            createdAt: '',
          };
        }

        const check = await subgraphRepo.checkById({ id: req.checkId, federatedGraphTargetId: graph.targetId });
        const checkDetails = await subgraphRepo.checkDetails(req.checkId, graph.targetId);

        if (!check || !checkDetails) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check not found',
            },
            operations: [],
            trafficCheckDays: 0,
            createdAt: '',
          };
        }

        const affectedOperations = await schemaCheckRepo.getAffectedOperationsByCheckId(req.checkId);

        const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

        const operationsRepo = new OperationsRepository(opts.db, graph.id);

        const overrides = await operationsRepo.getChangeOverrides({
          namespaceId: graph.namespaceId,
        });

        const ignoreAllOverrides = await operationsRepo.getIgnoreAllOverrides({
          namespaceId: graph.namespaceId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          operations: affectedOperations.map((operation) => ({
            ...operation,
            firstSeenAt: operation.firstSeenAt.toUTCString(),
            lastSeenAt: operation.lastSeenAt.toUTCString(),
            impactingChanges: checkDetails.changes
              .filter(({ id }) => operation.schemaChangeIds.includes(id))
              .map((c) => ({
                ...c,
                hasOverride: overrides.some(
                  (o) => o.hash === operation.hash && o.changeType === c.changeType && o.path === c.path,
                ),
              })),
            hasIgnoreAllOverride: ignoreAllOverrides.some((io) => io.hash === operation.hash),
            isSafe: operation.isSafe,
          })),
          trafficCheckDays,
          createdAt: check.timestamp,
        };
      });
    },

    getAnalyticsView: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetAnalyticsViewResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const analyticsRepo = new AnalyticsRequestViewRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
          };
        }

        const tracingRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'tracing-retention',
        });

        const { range, dateRange } = validateDateRanges({
          limit: tracingRetention?.limit ?? 7,
          range: req.config?.range,
          dateRange: req.config?.dateRange,
        });

        if (req.config) {
          if (range) {
            req.config.range = range;
          }
          if (dateRange) {
            req.config.dateRange = new DateRangeProto({
              start: dateRange.start,
              end: dateRange.end,
            });
          }
        }

        const view = await analyticsRepo.getView(authContext.organizationId, graph.id, req.name, req.config);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          view,
        };
      });
    },

    getDashboardAnalyticsView: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetDashboardAnalyticsViewResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            mostRequestedOperations: [],
            requestSeries: [],
            subgraphMetrics: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
            mostRequestedOperations: [],
            requestSeries: [],
            subgraphMetrics: [],
          };
        }

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { range, dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          range: req.range,
          dateRange:
            req.startDate !== '' && req.endDate !== ''
              ? {
                  start: req.startDate,
                  end: req.endDate,
                }
              : undefined,
        });

        const timeFilters = parseTimeFilters(dateRange, range);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphs = await subgraphRepo.listByFederatedGraph({
          federatedGraphTargetId: graph.targetId,
          published: true,
        });
        const view = await analyticsDashRepo.getView(graph.id, authContext.organizationId, timeFilters, subgraphs);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          mostRequestedOperations: view.mostRequestedOperations,
          requestSeries: view.requestSeries,
          subgraphMetrics: view.subgraphMetrics,
          federatedGraphMetrics: view.federatedGraphMetrics,
        };
      });
    },

    getGraphMetrics: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetGraphMetricsResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            filters: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const repo = new MetricsRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
            filters: [],
          };
        }

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { range, dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          range: req.range,
          dateRange: req.dateRange,
        });

        const view = await repo.getMetricsView({
          range,
          dateRange,
          filters: req.filters,
          organizationId: authContext.organizationId,
          graphId: graph.id,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          ...view,
        };
      });
    },

    getMetricsErrorRate: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetMetricsErrorRateResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            series: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const repo = new MetricsRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
            series: [],
          };
        }

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { range, dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          range: req.range,
          dateRange: req.dateRange,
        });

        const metrics = await repo.getErrorsView({
          range,
          dateRange,
          filters: req.filters,
          organizationId: authContext.organizationId,
          graphId: graph.id,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          series: metrics.errorRate.series,
          resolution: metrics.resolution,
        };
      });
    },

    getTrace: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetTraceResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            spans: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const traceRepo = new TraceRepository(opts.chClient);

        const spans = await traceRepo.getTrace(req.id, authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          spans,
        };
      });
    },

    getOrganizationMembers: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOrganizationMembersResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const orgMembers = await orgRepo.getMembers({ organizationID: authContext.organizationId });
        const pendingInvitations = await orgInvitationRepo.getPendingInvitationsOfOrganization({
          organizationId: authContext.organizationId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          members: orgMembers,
          pendingInvitations,
        };
      });
    },

    getLatestValidRouterConfig: (req, ctx) => {
      req.namespace = req.namespace || DefaultNamespace;

      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const federatedGraph = await fedGraphRepo.byName(req.graphName, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Federated graph not found',
            },
          };
        }

        const config = await fedGraphRepo.getLatestValidRouterConfig(federatedGraph?.targetId);
        if (!config) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'No valid router config found',
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          config: {
            subgraphs: config.config.subgraphs,
            engineConfig: config.config.engineConfig,
            version: config.schemaVersionId,
          },
        };
      });
    },

    getAPIKeys: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetAPIKeysResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const apiKeyRepo = new ApiKeyRepository(opts.db);

        const apiKeys = await apiKeyRepo.getAPIKeys({ organizationID: authContext.organizationId });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          apiKeys,
        };
      });
    },

    whoAmI: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<WhoAmIResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const organization = await orgRepo.byId(authContext.organizationId);

        if (!organization) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
            organizationName: '',
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          organizationName: organization.name,
        };
      });
    },

    getOrganizationWebhookConfigs: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOrganizationWebhookConfigsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const configs = await orgRepo.getWebhookConfigs(authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          configs,
        };
      });
    },

    getOrganizationWebhookMeta: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOrganizationWebhookMetaResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const eventsMeta = await orgRepo.getWebhookMeta(req.id, authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          eventsMeta,
        };
      });
    },

    // generates a temporary router token to fetch the router config only. Should only be used while fetching router config.
    generateRouterToken: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GenerateRouterTokenResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const auditLogRepo = new AuditLogRepository(opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            token: '',
          };
        }

        const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' not found`,
            },
            token: '',
          };
        }

        const token = await signJwtHS256<GraphApiKeyJwtPayload>({
          secret: opts.jwtSecret,
          token: {
            iss: authContext.userId,
            federated_graph_id: federatedGraph.id,
            aud: audiences.cosmoGraphKey, // to distinguish from other tokens
            organization_id: authContext.organizationId,
            exp: nowInSeconds() + 5 * 60, // 5 minutes
          },
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'router_config.fetched',
          action: 'fetched',
          actorId: authContext.userId,
          targetType: 'federated_graph',
          actorDisplayName: authContext.userDisplayName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
          auditableDisplayName: federatedGraph.name,
          auditableType: 'router_config',
          targetNamespaceId: federatedGraph.namespaceId,
          targetNamespaceDisplayName: federatedGraph.namespace,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          token,
        };
      });
    },

    getRouterTokens: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetRouterTokensResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        req.namespace = req.namespace || DefaultNamespace;

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            tokens: [],
          };
        }

        const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' not found`,
            },
            tokens: [],
          };
        }

        const tokens = await fedRepo.getRouterTokens({
          organizationId: authContext.organizationId,
          federatedGraphId: federatedGraph.id,
          limit: 100,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          // Don't return the token, only the metadata
          tokens: tokens.map(({ token, ...rest }) => ({
            id: rest.id,
            name: rest.name,
            createdAt: rest.createdAt,
            lastUsedAt: rest.lastUsedAt || '',
            creatorEmail: rest.creatorEmail || '',
          })),
        };
      });
    },

    getOrganizationIntegrations: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOrganizationIntegrationsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const integrations = await orgRepo.getIntegrations(authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          integrations,
        };
      });
    },

    isGitHubAppInstalled: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<IsGitHubAppInstalledResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepository = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        if (!opts.githubApp) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'GitHub app integration is disabled',
            },
            isInstalled: false,
          };
        }

        const org = orgRepository.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Organization not found',
            },
            isInstalled: false,
          };
        }

        if (!req.gitInfo) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            isInstalled: false,
          };
        }

        const githubRepository = new GitHubRepository(opts.db, opts.githubApp);
        const isInstalled = await githubRepository.isAppInstalledOnRepo({
          accountId: req.gitInfo.accountId,
          repoSlug: req.gitInfo.repositorySlug,
          ownerSlug: req.gitInfo.ownerSlug,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          isInstalled,
        };
      });
    },

    getFieldUsage: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetFieldUsageResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            clients: [],
            requestSeries: [],
          };
        }

        const usageRepo = new UsageRepository(opts.chClient);

        const graph = await federatedGraphRepo.byName(req.graphName, req.namespace);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            clients: [],
            requestSeries: [],
          };
        }

        let dr: DateRange | undefined;

        if (req.dateRange?.start && req.dateRange?.end) {
          dr = {
            start: req.dateRange?.start,
            end: req.dateRange?.end,
          };
        }

        const { clients, requestSeries, meta } = await usageRepo.getFieldUsage({
          federatedGraphId: graph.id,
          organizationId: authContext.organizationId,
          typename: req.typename,
          field: req.field,
          namedType: req.namedType,
          range: req.range,
          dateRange: dr,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          clients,
          requestSeries,
          meta,
        };
      });
    },

    getOperationContent: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOperationContentResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            operationContent: '',
          };
        }

        const query = `
          SELECT OperationContent as operationContent
          FROM ${opts.chClient?.database}.gql_metrics_operations
          WHERE OperationHash = '${req.hash}'
          LIMIT 1 SETTINGS use_query_cache = true, query_cache_ttl = 2629800
        `;

        const result = await opts.chClient.queryPromise(query);

        if (!Array.isArray(result)) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested operation not found',
            },
            operationContent: '',
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          operationContent: result[0].operationContent,
        };
      });
    },

    getOIDCProvider: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOIDCProviderResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const oidcRepo = new OidcRepository(opts.db);

        await opts.keycloakClient.authenticateClient();

        const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
        if (!provider) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
            name: '',
            endpoint: '',
            loginURL: '',
            signInRedirectURL: '',
            signOutRedirectURL: '',
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          name: provider.name,
          endpoint: provider.endpoint,
          loginURL: `${opts.webBaseUrl}/login?sso=${provider.alias}`,
          signInRedirectURL: `${opts.keycloakApiUrl}/realms/${opts.keycloakRealm}/broker/${provider.alias}/endpoint`,
          signOutRedirectURL: `${opts.keycloakApiUrl}/realms/${opts.keycloakRealm}/broker/${provider.alias}/endpoint/logout_response`,
        };
      });
    },

    getPersistedOperations: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetPersistedOperationsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' does not exist`,
            },
            operations: [],
          };
        }

        const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
        const operations = await operationsRepo.getPersistedOperations(req.clientId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          operations: operations.map((op) => ({
            ...op,
            id: op.operationId,
          })),
        };
      });
    },

    getRouters: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetRoutersResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            routers: [],
          };
        }

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' does not exist`,
            },
            routers: [],
          };
        }

        const routers: PlainMessage<Router>[] = [];

        const routerRepo = new RouterMetricsRepository(opts.chClient);
        const routersDTOs = await routerRepo.getActiveRouters({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
        });

        const graphCompositionRepository = new GraphCompositionRepository(logger, opts.db);

        for await (const routerDTO of routersDTOs) {
          let composition: GraphCompositionDTO | undefined;

          // Might be empty when starting with a local composed config that has no config version id
          if (routerDTO.configVersionId) {
            composition = await graphCompositionRepository.getGraphCompositionBySchemaVersion({
              organizationId: authContext.organizationId,
              schemaVersionId: routerDTO.configVersionId,
            });
          }

          const runtimeMetrics = await routerRepo.getRouterRuntime({
            organizationId: authContext.organizationId,
            federatedGraphId: federatedGraph.id,
            serviceInstanceId: routerDTO.serviceInstanceId,
          });

          routers.push({
            hostname: routerDTO.hostname,
            clusterName: routerDTO.clusterName,
            compositionId: composition?.id ?? '',
            serviceName: routerDTO.serviceName,
            serviceVersion: routerDTO.serviceVersion,
            serviceInstanceId: routerDTO.serviceInstanceId,
            uptimeSeconds: routerDTO.processUptimeSeconds,
            serverUptimeSeconds: runtimeMetrics.serverUptimeSeconds,
            onLatestComposition: composition?.isLatestValid ?? false,
            processId: routerDTO.processId,
            cpuUsagePercent: runtimeMetrics.cpuUsage.currentPercent ?? 0,
            cpuUsageChangePercent: runtimeMetrics.cpuUsage.changePercent,
            memoryUsageMb: runtimeMetrics.memoryUsage.currentMb ?? 0,
            memoryUsageChangePercent: runtimeMetrics.memoryUsage.changePercent ?? 0,
          });
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          routers,
        };
      });
    },

    getClients: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetClientsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' does not exist`,
            },
            clients: [],
          };
        }
        const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
        const clients = await operationsRepo.getRegisteredClients();

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          clients,
        };
      });
    },

    getOrganizationRequestsCount: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetOrganizationRequestsCountResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            count: BigInt(0),
          };
        }
        const monthlyRequestsRepo = new MonthlyRequestViewRepository(opts.chClient);
        const count = await monthlyRequestsRepo.getMonthlyRequestCount(authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          count: BigInt(count),
        };
      });
    },

    // returns the pending invites of a user
    getInvitations: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetInvitationsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          invitations: await orgInvitationRepo.getPendingInvitationsOfUser({ userId: authContext.userId }),
        };
      });
    },

    getCompositions: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetCompositionsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
        const graphCompositionRepository = new GraphCompositionRepository(logger, opts.db);

        req.namespace = req.namespace || DefaultNamespace;

        const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' does not exist`,
            },
            compositions: [],
            count: 0,
          };
        }

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          dateRange: {
            start: req.startDate,
            end: req.endDate,
          },
        });

        if (!dateRange) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid date range',
            },
            compositions: [],
            count: 0,
          };
        }

        // check that the limit is less than the max option provided in the ui
        if (req.limit > 50) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid limit',
            },
            compositions: [],
            count: 0,
          };
        }

        const compositions = await graphCompositionRepository.getGraphCompositions({
          fedGraphTargetId: federatedGraph.targetId,
          organizationId: authContext.organizationId,
          limit: req.limit,
          offset: req.offset,
          dateRange: {
            start: dateRange.start,
            end: dateRange.end,
          },
        });

        const compositionsCount = await graphCompositionRepository.getGraphCompositionsCount({
          fedGraphTargetId: federatedGraph.targetId,
          dateRange: {
            start: dateRange.start,
            end: dateRange.end,
          },
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositions,
          count: compositionsCount,
        };
      });
    },

    getCompositionDetails: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetCompositionDetailsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const compositionRepo = new GraphCompositionRepository(logger, opts.db);

        const composition = await compositionRepo.getGraphComposition({
          compositionId: req.compositionId,
          organizationId: authContext.organizationId,
        });

        if (!composition) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Graph composition with '${req.compositionId}' does not exist`,
            },
            compositionSubgraphs: [],
          };
        }

        const compositionSubgraphs = await compositionRepo.getCompositionSubgraphs({
          compositionId: req.compositionId,
        });

        const changelogs = await fedRepo.fetchChangelogByVersion({
          schemaVersionId: composition.schemaVersionId,
        });

        let addCount = 0;
        let minusCount = 0;
        for (const log of changelogs) {
          if (log.changeType.includes('REMOVED')) {
            minusCount += 1;
          } else if (log.changeType.includes('ADDED')) {
            addCount += 1;
          } else if (log.changeType.includes('CHANGED')) {
            addCount += 1;
            minusCount += 1;
          }
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          composition,
          compositionSubgraphs,
          changeCounts: {
            additions: addCount,
            deletions: minusCount,
          },
        };
      });
    },

    getSdlBySchemaVersion: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSdlBySchemaVersionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const sdl = await fedRepo.getSdlBasedOnSchemaVersion({
          targetId: req.targetId,
          schemaVersionId: req.schemaVersionId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sdl: sdl || '',
        };
      });
    },

    getChangelogBySchemaVersion: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetChangelogBySchemaVersionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

        const changelogs = await fedRepo.fetchChangelogByVersion({
          schemaVersionId: req.schemaVersionId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          changelog: {
            changelogs,
            schemaVersionId: req.schemaVersionId,
            createdAt: changelogs.length === 0 ? '' : changelogs[0].createdAt,
          },
        };
      });
    },

    getUserAccessibleResources: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetUserAccessibleResourcesResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        if (authContext.isAdmin) {
          const federatedGraphs = await fedRepo.list({
            limit: 0,
            offset: 0,
          });

          const subgraphs = await subgraphRepo.list({
            limit: 0,
            offset: 0,
          });

          return {
            response: {
              code: EnumStatusCode.OK,
            },
            federatedGraphs: federatedGraphs.map((g) => ({
              targetId: g.targetId,
              name: g.name,
              namespace: g.namespace,
            })),
            subgraphs: subgraphs.map((g) => ({
              targetId: g.targetId,
              name: g.name,
              namespace: g.namespace,
            })),
          };
        }

        const federatedGraphs = await fedRepo.getAccessibleFederatedGraphs(authContext.userId);

        const subgraphs = await subgraphRepo.getAccessibleSubgraphs(authContext.userId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          federatedGraphs: federatedGraphs.map((g) => ({
            targetId: g.targetId,
            name: g.name,
            namespace: g.namespace,
          })),
          subgraphs: subgraphs.map((g) => ({
            targetId: g.targetId,
            name: g.name,
            namespace: g.namespace,
          })),
        };
      });
    },

    getSubgraphMembers: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSubgraphMembersResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

        // check if the subgraph exists
        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph ${req.subgraphName} not found`,
            },
            members: [],
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          members: await subgraphRepo.getSubgraphMembers(subgraph.id),
        };
      });
    },

    getBillingPlans: (req, ctx) => {
      const logger = ctx.values.get<FastifyBaseLogger>({ id: Symbol('logger'), defaultValue: opts.logger });

      return handleError<PlainMessage<GetBillingPlansResponse>>(ctx, logger, async () => {
        const billingRepo = new BillingRepository(opts.db);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          plans: await billingRepo.listPlans(),
        };
      });
    },

    getAuditLogs: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetAuditLogsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const orgRepo = new OrganizationRepository(logger, opts.db);
        const auditLogRepo = new AuditLogRepository(opts.db);

        if (!authContext.isAdmin) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            logs: [],
            count: 0,
          };
        }

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          dateRange: {
            start: req.startDate,
            end: req.endDate,
          },
        });

        if (!dateRange) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid date range',
            },
            logs: [],
            count: 0,
          };
        }

        // check that the limit is less than the max option provided in the ui
        if (req.limit > 50) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Invalid limit',
            },
            logs: [],
            count: 0,
          };
        }

        const auditLogs = await auditLogRepo.getAuditLogs({
          organizationId: authContext.organizationId,
          limit: req.limit,
          offset: req.offset,
          startDate: dateRange.start,
          endDate: dateRange.end,
        });
        const auditLogsCount = await auditLogRepo.getAuditLogsCount({
          organizationId: authContext.organizationId,
          startDate: dateRange.start,
          endDate: dateRange.end,
        });

        const logs: PlainMessage<AuditLog>[] = auditLogs.map((log) => ({
          actorDisplayName: log.actorDisplayName ?? '',
          actorType: log.actorType ?? '',
          auditAction: log.auditAction,
          createdAt: log.createdAt.toISOString(),
          auditableDisplayName: log.auditableDisplayName ?? '',
          targetType: log.targetType ?? '',
          action: log.action,
          targetDisplayName: log.targetDisplayName ?? '',
          id: log.id,
          targetNamespaceDisplayName: log.targetNamespaceDisplayName ?? '',
          targetNamespaceId: log.targetNamespaceId ?? '',
        }));

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          logs,
          count: auditLogsCount,
        };
      });
    },

    createOrganization: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateOrganizationResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const billingRepo = new BillingRepository(opts.db);
        const plans = await billingRepo.listPlans();

        if (opts.stripeSecretKey) {
          if (!plans?.length) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: 'No billing plans configured. Please contact support.',
              },
            };
          }

          // Validate the plan
          if (plans?.length && !plans.some((plan) => plan.id === req.plan && 'stripePriceId' in plan)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: 'Invalid plan. Please contact support.',
              },
            };
          }
        }

        await opts.keycloakClient.authenticateClient();

        // Create the organization group in Keycloak + subgroups
        await opts.keycloakClient.seedGroup({
          userID: authContext.userId,
          organizationSlug: req.slug,
          realm: opts.keycloakRealm,
        });

        try {
          const data = await opts.db.transaction(async (tx) => {
            const orgRepo = new OrganizationRepository(logger, tx, opts.billingDefaultPlanId);
            const billingRepo = new BillingRepository(tx);
            const billingService = new BillingService(tx, billingRepo);
            const auditLogRepo = new AuditLogRepository(tx);

            const organization = await orgRepo.createOrganization({
              organizationName: req.name,
              organizationSlug: req.slug,
              ownerID: authContext.userId,
            });

            await auditLogRepo.addAuditLog({
              organizationId: organization.id,
              auditAction: 'organization.created',
              action: 'created',
              actorId: authContext.userId,
              targetId: organization.id,
              targetType: 'organization',
              targetDisplayName: organization.name,
              auditableType: 'organization',
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
              auditableDisplayName: organization.name,
            });

            const orgMember = await orgRepo.addOrganizationMember({
              organizationID: organization.id,
              userID: authContext.userId,
            });

            await orgRepo.addOrganizationMemberRoles({
              memberID: orgMember.id,
              roles: ['admin'],
            });

            let sessionId: string | undefined;
            if (opts.stripeSecretKey) {
              const session = await billingService.createCheckoutSession({
                organizationId: organization.id,
                organizationSlug: organization.slug,
                plan: req.plan,
              });
              sessionId = session.id;
            }

            const namespaceRepo = new NamespaceRepository(tx, organization.id);
            const ns = await namespaceRepo.create({
              name: DefaultNamespace,
              createdBy: authContext.userId,
            });

            if (!ns) {
              throw new PublicError(EnumStatusCode.ERR, `Could not create ${DefaultNamespace} namespace`);
            }

            await auditLogRepo.addAuditLog({
              organizationId: authContext.organizationId,
              auditAction: 'namespace.created',
              action: 'created',
              actorId: authContext.userId,
              auditableType: 'namespace',
              auditableDisplayName: ns.name,
              actorDisplayName: authContext.userDisplayName,
              actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
            });

            return {
              organization,
              sessionId,
            };
          });

          return {
            response: {
              code: EnumStatusCode.OK,
            },
            organization: {
              id: data.organization.id,
              name: data.organization.name,
              slug: data.organization.slug,
              createdAt: data.organization.createdAt,
              creatorUserId: data.organization.creatorUserId,
            },
            stripeSessionId: data.sessionId,
          };
        } catch (err) {
          logger.error(err);

          // Delete the organization group in Keycloak + subgroups
          // when the organization creation fails
          await opts.keycloakClient.deleteOrganizationGroup({
            realm: opts.keycloakRealm,
            organizationSlug: req.slug,
          });

          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Organization creation failed',
            },
          };
        }
      });
    },

    createCheckoutSession: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateCheckoutSessionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const billingRepo = new BillingRepository(opts.db);
        const billingService = new BillingService(opts.db, billingRepo);

        if (!opts.stripeSecretKey) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Billing is not enabled. Please contact support.',
            },
            sessionId: '',
          };
        }

        const session = await billingService.createCheckoutSession({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          plan: req.plan,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sessionId: session.id,
        };
      });
    },

    upgradePlan: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpgradePlanResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const billingRepo = new BillingRepository(opts.db);
        const billingService = new BillingService(opts.db, billingRepo);
        const auditLogRepository = new AuditLogRepository(opts.db);

        if (!opts.stripeSecretKey) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Billing is not enabled. Please contact support.',
            },
          };
        }

        const plan = await billingRepo.getPlanById(req.plan);
        if (!plan) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Plan not found',
            },
          };
        }

        await billingService.upgradePlan({
          organizationId: authContext.organizationId,
          planId: plan.id,
        });

        await auditLogRepository.addAuditLog({
          organizationId: authContext.organizationId,
          auditAction: 'subscription.upgraded',
          action: 'upgraded',
          auditableType: 'subscription',
          auditableDisplayName: plan.name,
          actorDisplayName: 'cosmo-bot',
          actorType: 'system',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createBillingPortalSession: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateBillingPortalSessionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const billingRepo = new BillingRepository(opts.db);
        const billingService = new BillingService(opts.db, billingRepo);

        if (!opts.stripeSecretKey) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Billing is not enabled. Please contact support.',
            },
            sessionId: '',
            url: '',
          };
        }

        const session = await billingService.createBillingPortalSession({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sessionId: session.id,
          url: session.url,
        };
      });
    },

    createDiscussion: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<CreateDiscussionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const canCreateDiscussion = await discussionRepo.canAccessTarget(req.targetId);
        if (!canCreateDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to create a discussion in this graph',
            },
          };
        }

        await discussionRepo.createDiscussion({
          ...req,
          createdById: authContext.userId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    replyToDiscussion: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<ReplyToDiscussionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
        if (!canAccessDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to view or modify this discussion',
            },
          };
        }

        const isResolved = await discussionRepo.isResolved(req.discussionId);
        if (isResolved) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'You cannot reply to a resolved discussion',
            },
          };
        }

        await discussionRepo.replyToDiscussion({
          ...req,
          createdById: authContext.userId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getAllDiscussions: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetAllDiscussionsResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const canReply = await discussionRepo.canAccessTarget(req.targetId);
        if (!canReply) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to the discussions of this graph',
            },
            discussions: [],
          };
        }

        const graphDiscussions = await discussionRepo.getAllDiscussions({
          ...req,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          discussions: graphDiscussions.map((gd) => ({
            id: gd.id,
            schemaVersionId: gd.schemaVersionId,
            targetId: gd.targetId,
            referenceLine: gd.referenceLine ?? '',
            isResolved: gd.isResolved,
            openingComment: {
              id: gd.thread[0].id,
              contentJson: JSON.stringify(gd.thread[0].contentJson),
              createdAt: gd.thread[0].createdAt.toISOString(),
              updatedAt: gd.thread[0].updatedAt?.toISOString(),
              createdBy: gd.thread[0].createdById,
              isDeleted: gd.thread[0].isDeleted,
            },
          })),
        };
      });
    },

    updateDiscussionComment: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<UpdateDiscussionCommentResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
        if (!canAccessDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to view or modify this discussion',
            },
          };
        }
        const updated = await discussionRepo.updateComment({
          ...req,
          createdById: authContext.userId,
        });

        if (updated.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Failed to update comment',
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteDiscussionComment: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<DeleteDiscussionCommentResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db);

        const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
        if (!canAccessDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to view or modify this discussion',
            },
          };
        }

        const comment = await discussionRepo.getCommentById(req.commentId);
        if (!comment) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'The comment could not be found',
            },
          };
        }

        const userRoles = await orgRepo.getOrganizationMemberRoles({
          userID: authContext.userId || '',
          organizationID: authContext.organizationId,
        });

        if (!(comment.createdById === authContext.userId || userRoles.includes('admin'))) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `You are not authorized to delete this comment'`,
            },
          };
        }

        const success = await discussionRepo.deleteComment({
          ...req,
        });

        if (!success) {
          return {
            response: {
              code: EnumStatusCode.ERR,
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getDiscussion: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetDiscussionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const exists = await discussionRepo.exists(req.discussionId);
        if (!exists) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Could not find discussion',
            },
            comments: [],
          };
        }

        const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
        if (!canAccessDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to view or modify this discussion',
            },
            comments: [],
          };
        }

        const graphDiscussion = await discussionRepo.byId(req.discussionId);

        if (!graphDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Discussion not found`,
            },
            comments: [],
          };
        }

        const comments = graphDiscussion.thread.map((t) => ({
          id: t.id,
          contentJson: t.contentJson ? JSON.stringify(t.contentJson) : '',
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt?.toISOString(),
          createdBy: t.createdById,
          isDeleted: t.isDeleted,
        }));

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          discussion: {
            id: graphDiscussion.id,
            schemaVersionId: graphDiscussion.schemaVersionId,
            targetId: graphDiscussion.targetId,
            referenceLine: graphDiscussion.referenceLine ?? '',
            openingComment: comments[0],
            isResolved: graphDiscussion.isResolved,
          },
          comments,
        };
      });
    },

    getDiscussionSchemas: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetDiscussionSchemasResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
        if (!canAccessDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to view or modify this discussion',
            },
          };
        }

        const graphDiscussion = await discussionRepo.byId(req.discussionId);

        if (!graphDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Discussion not found`,
            },
            comments: [],
          };
        }

        const { referenceResult, latestResult } = await discussionRepo.getSchemas({
          targetId: graphDiscussion.targetId,
          schemaVersionId: graphDiscussion.schemaVersionId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          schemas: {
            reference: referenceResult?.schemaSDL ?? '',
            latest: latestResult?.schemaSDL ?? '',
          },
        };
      });
    },

    setDiscussionResolution: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<SetDiscussionResolutionResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const discussionRepo = new DiscussionRepository(opts.db, authContext.organizationId);

        const canAccessDiscussion = await discussionRepo.canAccessDiscussion(req.discussionId);
        if (!canAccessDiscussion) {
          return {
            response: {
              code: EnumStatusCode.ERROR_NOT_AUTHORIZED,
              details: 'You are not authorized to view or modify this discussion',
            },
          };
        }

        await discussionRepo.setResolution({
          ...req,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getSubgraphMetrics: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSubgraphMetricsResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            filters: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphMetricsRepo = new SubgraphMetricsRepository(logger, opts.chClient, opts.db);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            filters: [],
          };
        }

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { range, dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          range: req.range,
          dateRange: req.dateRange,
        });

        const view = await subgraphMetricsRepo.getSubgraphMetricsView({
          range,
          dateRange,
          filters: req.filters,
          organizationId: authContext.organizationId,
          subgraphId: subgraph.id,
          subgraphLabels: subgraph.labels,
          namespaceId: subgraph.namespaceId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          ...view,
        };
      });
    },

    getSubgraphMetricsErrorRate: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetSubgraphMetricsErrorRateResponse>>(ctx, logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            series: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const subgraphMetricsRepo = new SubgraphMetricsRepository(logger, opts.chClient, opts.db);
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

        const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            series: [],
          };
        }

        const analyticsRetention = await orgRepo.getFeature({
          organizationId: authContext.organizationId,
          featureId: 'analytics-retention',
        });

        const { range, dateRange } = validateDateRanges({
          limit: analyticsRetention?.limit ?? 7,
          range: req.range,
          dateRange: req.dateRange,
        });

        const metrics = await subgraphMetricsRepo.getSubgraphErrorsView({
          range,
          dateRange,
          filters: req.filters,
          organizationId: authContext.organizationId,
          subgraphId: subgraph.id,
          subgraphLabels: subgraph.labels,
          namespaceId: subgraph.namespaceId,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          series: metrics.errorRate.series,
          resolution: metrics.resolution,
        };
      });
    },

    getNamespaceLintConfig: (req, ctx) => {
      let logger = getLogger(ctx, opts.logger);

      return handleError<PlainMessage<GetNamespaceLintConfigResponse>>(ctx, logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        logger = enrichLogger(ctx, logger, authContext);

        const schemaLintRepo = new SchemaLintRepository(opts.db);
        const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

        const namespace = await namespaceRepo.byName(req.namespace);
        if (!namespace) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Namespace '${req.namespace}' not found`,
            },
            configs: [],
            linterEnabled: false,
          };
        }

        const orgLintConfigs = await schemaLintRepo.getNamespaceLintConfig(namespace.id);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          configs: orgLintConfigs.map((l) => {
            return {
              ruleName: l.ruleName,
              severityLevel: l.severity === 'error' ? LintSeverity.error : LintSeverity.warn,
            } as LintConfig;
          }),
          linterEnabled: namespace.enableLinting,
        };
      });
    },
  };
}
