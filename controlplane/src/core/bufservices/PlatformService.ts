import crypto from 'node:crypto';
import { PlainMessage } from '@bufbuild/protobuf';
import { ServiceImpl } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetConfigResponse } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { OrganizationEventName, PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import {
  AcceptOrDeclineInvitationResponse,
  AddSubgraphMemberResponse,
  AnalyticsConfig,
  CheckFederatedGraphResponse,
  CheckSubgraphSchemaResponse,
  CompositionError,
  CreateAPIKeyResponse,
  CreateFederatedGraphResponse,
  CreateFederatedGraphTokenResponse,
  CreateFederatedSubgraphResponse,
  CreateIntegrationResponse,
  CreateOIDCProviderResponse,
  CreateOrganizationWebhookConfigResponse,
  DateRange,
  DeleteAPIKeyResponse,
  DeleteFederatedGraphResponse,
  DeleteFederatedSubgraphResponse,
  DeleteIntegrationResponse,
  DeleteOIDCProviderResponse,
  DeleteOrganizationResponse,
  DeleteRouterTokenResponse,
  FixSubgraphSchemaResponse,
  ForceCheckSuccessResponse,
  GetAPIKeysResponse,
  GetAnalyticsViewResponse,
  GetChangelogBySchemaVersionResponse,
  GetCheckDetailsResponse,
  GetCheckOperationsResponse,
  GetCheckSummaryResponse,
  GetChecksByFederatedGraphNameResponse,
  GetClientsResponse,
  GetCompositionDetailsResponse,
  GetCompositionsResponse,
  GetDashboardAnalyticsViewResponse,
  GetFederatedGraphByNameResponse,
  GetFederatedGraphChangelogResponse,
  GetFederatedGraphSDLByNameResponse,
  GetFederatedGraphsResponse,
  GetFieldUsageResponse,
  GetGraphMetricsResponse,
  GetInvitationsResponse,
  GetLatestValidSubgraphSDLByNameResponse,
  GetMetricsErrorRateResponse,
  GetOIDCProviderResponse,
  GetOperationContentResponse,
  GetOrganizationIntegrationsResponse,
  GetOrganizationMembersResponse,
  GetOrganizationRequestsCountResponse,
  GetOrganizationWebhookConfigsResponse,
  GetOrganizationWebhookMetaResponse,
  GetPersistedOperationsResponse,
  GetRouterTokensResponse,
  GetSdlBySchemaVersionResponse,
  GetSubgraphByNameResponse,
  GetSubgraphMembersResponse,
  GetSubgraphsResponse,
  GetTraceResponse,
  GetUserAccessibleResourcesResponse,
  InviteUserResponse,
  IsGitHubAppInstalledResponse,
  IsRBACEnabledResponse,
  LeaveOrganizationResponse,
  MigrateFromApolloResponse,
  PublishFederatedSubgraphResponse,
  PublishPersistedOperationsResponse,
  PublishedOperation,
  PublishedOperationStatus,
  RemoveInvitationResponse,
  RemoveSubgraphMemberResponse,
  RequestSeriesItem,
  UpdateFederatedGraphResponse,
  UpdateIntegrationConfigResponse,
  UpdateOrgMemberRoleResponse,
  UpdateOrganizationDetailsResponse,
  UpdateOrganizationWebhookConfigResponse,
  UpdateRBACSettingsResponse,
  UpdateSubgraphResponse,
  WhoAmIResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OpenAIGraphql, isValidUrl } from '@wundergraph/cosmo-shared';
import { DocumentNode, buildASTSchema, parse } from 'graphql';
import { validate } from 'graphql/validation/index.js';
import { uid } from 'uid';
import {
  GraphApiKeyDTO,
  GraphApiKeyJwtPayload,
  PublishedOperationData,
  UpdatedPersistedOperation,
} from '../../types/index.js';
import { Composer } from '../composition/composer.js';
import { buildSchema, composeSubgraphs } from '../composition/composition.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';
import { signJwt } from '../crypto/jwt.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { GitHubRepository } from '../repositories/GitHubRepository.js';
import { GraphCompositionRepository } from '../repositories/GraphCompositionRepository.js';
import { OidcRepository } from '../repositories/OidcRepository.js';
import { OperationsRepository } from '../repositories/OperationsRepository.js';
import { OrganizationInvitationRepository } from '../repositories/OrganizationInvitationRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../repositories/SchemaCheckRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { AnalyticsDashboardViewRepository } from '../repositories/analytics/AnalyticsDashboardViewRepository.js';
import { AnalyticsRequestViewRepository } from '../repositories/analytics/AnalyticsRequestViewRepository.js';
import { MetricsRepository } from '../repositories/analytics/MetricsRepository.js';
import { MonthlyRequestViewRepository } from '../repositories/analytics/MonthlyRequestViewRepository.js';
import { TraceRepository } from '../repositories/analytics/TraceRepository.js';
import { UsageRepository } from '../repositories/analytics/UsageRepository.js';
import type { RouterOptions } from '../routes.js';
import { ApiKeyGenerator } from '../services/ApiGenerator.js';
import ApolloMigrator from '../services/ApolloMigrator.js';
import OidcProvider from '../services/OidcProvider.js';
import {
  InspectorOperationResult,
  InspectorSchemaChange,
  SchemaUsageTrafficInspector,
  collectOperationUsageStats,
} from '../services/SchemaUsageTrafficInspector.js';
import Slack from '../services/Slack.js';
import {
  extractOperationNames,
  formatSubscriptionProtocol,
  getHighestPriorityRole,
  handleError,
  isValidLabelMatchers,
  isValidLabels,
  isValidOrganizationSlug,
  validateDateRanges,
} from '../util.js';
import { FederatedGraphSchemaUpdate, OrganizationWebhookService } from '../webhooks/OrganizationWebhookService.js';
import { ApiKeyRepository } from '../repositories/ApiKeyRepository.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof PlatformService>> {
  return {
    /* 
    Mutations
    */
    createFederatedGraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateFederatedGraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesn't have the permissions to perform this operation`,
            },
            compositionErrors: [],
          };
        }

        if (await fedGraphRepo.exists(req.name)) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Federated graph '${req.name}' already exists`,
            },
            compositionErrors: [],
          };
        }

        if (!isValidLabelMatchers(req.labelMatchers)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One or more labels in the matcher were found to be invalid`,
            },
            compositionErrors: [],
          };
        }

        const federatedGraph = await fedGraphRepo.create({
          name: req.name,
          labelMatchers: req.labelMatchers,
          routingUrl: req.routingUrl,
        });

        await fedGraphRepo.createGraphCryptoKeyPairs({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
        });

        const subgraphs = await subgraphRepo.listByFederatedGraph(req.name, {
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
          };
        }

        const compositionErrors: PlainMessage<CompositionError>[] = [];

        await opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(tx, authContext.organizationId);
          const compositionRepo = new GraphCompositionRepository(tx);
          const compChecker = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);
          const composition = await compChecker.composeFederatedGraph(federatedGraph);

          compositionErrors.push(
            ...composition.errors.map((e) => ({
              federatedGraphName: federatedGraph.name,
              message: e.message,
            })),
          );

          await compChecker.deployComposition(composition, authContext.userId);
        });

        orgWebhooks.send(OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED, {
          federated_graph: {
            id: federatedGraph.id,
            name: federatedGraph.name,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          errors: compositionErrors.length > 0,
          actor_id: authContext.userId,
        });

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
        };
      });
    },

    createFederatedSubgraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateFederatedSubgraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const exists = await subgraphRepo.exists(req.name);

        if (!isValidLabels(req.labels)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One ore more labels were found to be invalid`,
            },
            compositionErrors: [],
          };
        }

        if (!exists) {
          const subgraph = await subgraphRepo.create({
            name: req.name,
            labels: req.labels,
            routingUrl: req.routingUrl,
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
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    checkSubgraphSchema: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CheckSubgraphSchemaResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);
        const compositionRepo = new GraphCompositionRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
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
          };
        }

        const subgraph = await subgraphRepo.byName(req.subgraphName);

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
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
          logger.debug(`Error finding diff between graphs: ${schemaChanges.error}`);
          return {
            response: {
              code: schemaChanges.errorCode,
              details: schemaChanges.errorMessage,
            },
            breakingChanges: [],
            nonBreakingChanges: [],
            compositionErrors: [],
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

        const composer = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);

        const result = req.delete
          ? await composer.composeWithDeletedSubgraph(subgraph.labels, subgraph.name)
          : await composer.composeWithProposedSDL(subgraph.labels, subgraph.name, newSchemaSDL);

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

        for (const composition of result.compositions) {
          const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });

          await schemaCheckRepo.createCheckedFederatedGraph(
            schemaCheckID,
            composition.id,
            orgLimits.breakingChangeRetentionLimit,
          );

          // We collect composition errors for all federated graphs
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
              });
            }
          }

          // We don't collect operation usage when we have composition errors or
          // when we don't have any inspectable changes. That means any breaking change is really breaking
          if (composition.errors.length === 0 && isInspectable && inspectorChanges.length > 0) {
            if (orgLimits.breakingChangeRetentionLimit <= 0) {
              continue;
            }

            const result = await trafficInspector.inspect(inspectorChanges, {
              daysToConsider: orgLimits.breakingChangeRetentionLimit,
              federatedGraphId: composition.id,
              organizationId: authContext.organizationId,
            });

            if (result.size > 0) {
              // If we have at least one operation with traffic, we consider this schema change as breaking
              // and skip the rest of the federated graphs
              hasClientTraffic = true;

              // Store operation usage
              await schemaCheckRepo.createOperationUsage(result);

              // Collect all inspected operations for later aggregation
              for (const resultElement of result.values()) {
                inspectedOperations.push(...resultElement);
              }
            }
          }
        }

        // Update the overall schema check with the results
        await schemaCheckRepo.update({
          schemaCheckID,
          hasClientTraffic,
          hasBreakingChanges,
        });

        if (req.gitInfo && opts.githubApp) {
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
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          breakingChanges: schemaChanges.breakingChanges,
          nonBreakingChanges: schemaChanges.nonBreakingChanges,
          operationUsageStats: isInspectable ? collectOperationUsageStats(inspectedOperations) : undefined,
          compositionErrors,
        };
      });
    },

    fixSubgraphSchema: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<FixSubgraphSchemaResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const subgraph = await subgraphRepo.byName(req.subgraphName);
        const compositionRepo = new GraphCompositionRepository(opts.db);
        const compChecker = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);

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

        if (!process.env.OPENAI_API_KEY) {
          return {
            response: {
              code: EnumStatusCode.ERR_OPENAI_DISABLED,
              details: `Env var 'OPENAI_API_KEY' must be set to use this feature`,
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
        const newSchemaSDL = new TextDecoder().decode(req.schema);

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

        const result = await compChecker.composeWithProposedSDL(subgraph.labels, subgraph.name, newSchemaSDL);

        const compositionErrors: PlainMessage<CompositionError>[] = [];
        for (const composition of result.compositions) {
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
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
          openAiApiKey: process.env.OPENAI_API_KEY,
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

    publishFederatedSubgraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<PublishFederatedSubgraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
          };
        }

        const subgraphSchemaSDL = new TextDecoder().decode(req.schema);

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
            };
          }
        } catch (e: any) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_SUBGRAPH_SCHEMA,
              details: e.message,
            },
            compositionErrors: [],
          };
        }

        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        let subgraph = await subgraphRepo.byName(req.name);

        // Check if the subgraph already exists and if it doesn't, validate input and create it
        if (!subgraph) {
          if (!isValidLabels(req.labels)) {
            return {
              response: {
                code: EnumStatusCode.ERR_INVALID_LABELS,
                details: `One ore more labels were found to be invalid`,
              },
              compositionErrors: [],
            };
          }

          if (!req.routingUrl) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `Routing URL is required to create a new subgraph`,
              },
              compositionErrors: [],
            };
          }

          if (req.labels.length === 0) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `At least one label is required to create a new subgraph`,
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

          // Create the subgraph if it doesn't exist
          subgraph = await subgraphRepo.create({
            name: req.name,
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
        }

        const { compositionErrors, updatedFederatedGraphs } = await subgraphRepo.update({
          name: req.name,
          labels: req.labels,
          routingUrl: req.routingUrl,
          subscriptionUrl: req.subscriptionUrl,
          schemaSDL: subgraphSchemaSDL,
          subscriptionProtocol: req.subscriptionProtocol
            ? formatSubscriptionProtocol(req.subscriptionProtocol)
            : undefined,
          updatedBy: authContext.userId,
        });

        for (const graph of updatedFederatedGraphs) {
          orgWebhooks.send(OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED, {
            federated_graph: {
              id: graph.id,
              name: graph.name,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: compositionErrors.length > 0,
            actor_id: authContext.userId,
          });
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
        };
      });
    },

    forceCheckSuccess: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<ForceCheckSuccessResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            changes: [],
            compositionErrors: [],
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            changes: [],
            compositionErrors: [],
          };
        }

        const check = await subgraphRepo.checkById(req.checkId, graph.name);

        if (!check) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check does not exist',
            },
            changes: [],
            compositionErrors: [],
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

    deleteFederatedGraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteFederatedGraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.name);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
          };
        }

        const blobStorageDirectory = `${authContext.organizationId}/${federatedGraph.id}`;
        await opts.blobStorage.removeDirectory(blobStorageDirectory);

        const subgraphsTargetIDs: string[] = [];
        const subgraphs = await subgraphRepo.listByFederatedGraph(req.name);
        for (const subgraph of subgraphs) {
          subgraphsTargetIDs.push(subgraph.targetId);
        }

        await fedGraphRepo.delete(federatedGraph.targetId, subgraphsTargetIDs);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteFederatedSubgraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteFederatedSubgraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
          };
        }

        const subgraph = await subgraphRepo.byName(req.subgraphName);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
            compositionErrors: [],
          };
        }

        const federatedGraphSchemaUpdates: FederatedGraphSchemaUpdate[] = [];
        const compositionErrors: PlainMessage<CompositionError>[] = [];

        await opts.db.transaction(async (tx) => {
          const fedGraphRepo = new FederatedGraphRepository(tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(tx, authContext.organizationId);
          const compositionRepo = new GraphCompositionRepository(tx);
          const composer = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);

          // Collect all federated graphs that used this subgraph before deleting subgraph to include them in the composition
          const affectedFederatedGraphs = await fedGraphRepo.bySubgraphLabels(subgraph.labels);

          // Delete the subgraph
          await subgraphRepo.delete(subgraph.targetId);

          // Collect all federated graphs that use this subgraph after deleting the subgraph
          const currentFederatedGraphs = await fedGraphRepo.bySubgraphLabels(subgraph.labels);

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

            await composer.deployComposition(composition, authContext.userId);

            // Collect all composition errors

            compositionErrors.push(
              ...composition.errors.map((e) => ({
                federatedGraphName: composition.name,
                message: e.message,
              })),
            );

            federatedGraphSchemaUpdates.push({
              federated_graph: {
                id: composition.targetID,
                name: composition.name,
              },
              organization: {
                id: authContext.organizationId,
                slug: authContext.organizationSlug,
              },
              errors: composition.errors.length > 0,
              actor_id: authContext.userId,
            });
          }
        });

        for (const update of federatedGraphSchemaUpdates) {
          orgWebhooks.send(OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED, update);
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
        };
      });
    },

    updateFederatedGraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateFederatedGraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.name);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
            compositionErrors: [],
          };
        }

        if (!isValidLabelMatchers(req.labelMatchers)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One or more labels in the matcher were found to be invalid`,
            },
            compositionErrors: [],
          };
        }

        let compositionErrors: PlainMessage<CompositionError>[] = [];

        const errors = await fedGraphRepo.update({
          name: req.name,
          labelMatchers: req.labelMatchers,
          routingUrl: req.routingUrl,
          updatedBy: authContext.userId,
        });

        if (errors) {
          compositionErrors = errors.map((e) => ({
            federatedGraphName: req.name,
            message: e.message,
          }));
        }

        orgWebhooks.send(OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED, {
          federated_graph: {
            id: federatedGraph.id,
            name: federatedGraph.name,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          errors: false,
          actor_id: authContext.userId,
        });

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
        };
      });
    },

    updateSubgraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateSubgraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            compositionErrors: [],
          };
        }

        const subgraph = await subgraphRepo.byName(req.name);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.name}' not found`,
            },
            compositionErrors: [],
          };
        }

        if (!isValidLabels(req.labels)) {
          return {
            response: {
              code: EnumStatusCode.ERR_INVALID_LABELS,
              details: `One ore more labels were found to be invalid`,
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

        const { compositionErrors, updatedFederatedGraphs } = await subgraphRepo.update({
          name: req.name,
          labels: req.labels,
          subscriptionUrl: req.subscriptionUrl,
          routingUrl: req.routingUrl,
          subscriptionProtocol: req.subscriptionProtocol
            ? formatSubscriptionProtocol(req.subscriptionProtocol)
            : undefined,
          updatedBy: authContext.userId,
        });

        for (const graph of updatedFederatedGraphs) {
          orgWebhooks.send(OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED, {
            federated_graph: {
              id: graph.id,
              name: graph.name,
            },
            organization: {
              id: authContext.organizationId,
              slug: authContext.organizationSlug,
            },
            errors: compositionErrors.length > 0,
            actor_id: authContext.userId,
          });
        }

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
            },
            compositionErrors,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositionErrors: [],
        };
      });
    },

    checkFederatedGraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CheckFederatedGraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

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

        const exists = await fedGraphRepo.exists(req.name);
        if (!exists) {
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

        const subgraphs = await subgraphRepo.byGraphLabelMatchers(req.labelMatchers);

        const subgraphsDetails = subgraphs.map((s) => ({
          id: s.id,
          name: s.name,
          routingURL: s.routingUrl,
          labels: s.labels,
          lastUpdatedAt: s.lastUpdatedAt,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateFederatedGraphTokenResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
            token: '',
          };
        }

        const graph = await fedGraphRepo.byName(req.graphName);
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

        const tokenValue = await signJwt<GraphApiKeyJwtPayload>({
          secret: opts.jwtSecret,
          token: {
            iss: authContext.userId,
            federated_graph_id: graph.id,
            organization_id: authContext.organizationId,
          },
        });

        const token = await fedGraphRepo.createToken({
          token: tokenValue,
          federatedGraphId: graph.id,
          tokenName: req.tokenName,
          organizationId: authContext.organizationId,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<InviteUserResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const userRepo = new UserRepository(opts.db);
        const orgRepo = new OrganizationRepository(opts.db);
        const orgInvitationRepo = new OrganizationInvitationRepository(opts.db);

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
                  recieverEmail: req.email,
                  invitedBy: orgInvitation.invitedBy,
                });
              }
            }

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
              recieverEmail: req.email,
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

        return {
          response: {
            code: EnumStatusCode.OK,
            details: 'Invited member successfully.',
          },
        };
      });
    },

    createAPIKey: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateAPIKeyResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const apiKeyRepo = new ApiKeyRepository(opts.db);

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

        await apiKeyRepo.addAPIKey({
          name: keyName,
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
          key: generatedAPIKey,
          expiresAt: req.expires,
          targetIds: [...req.federatedGraphTargetIds, ...req.subgraphTargetIds],
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteAPIKeyResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const apiKeyRepo = new ApiKeyRepository(opts.db);

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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeOrganizationMember: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<RemoveInvitationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
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

        const groupName = org.slug;

        const organizationGroup = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: groupName,
          realm: opts.keycloakRealm,
        });

        if (organizationGroup.length === 0) {
          throw new Error(`Organization group '${org.slug}' not found`);
        }

        for (const role of orgMember.roles) {
          switch (role) {
            case 'admin': {
              const adminGroup = await opts.keycloakClient.fetchAdminChildGroup({
                realm: opts.keycloakRealm,
                kcGroupId: organizationGroup[0].id!,
                orgSlug: groupName,
              });
              await opts.keycloakClient.client.users.delFromGroup({
                id: user.id,
                groupId: adminGroup.id!,
                realm: opts.keycloakRealm,
              });
              break;
            }
            case 'developer': {
              const devGroup = await opts.keycloakClient.fetchDevChildGroup({
                realm: opts.keycloakRealm,
                kcGroupId: organizationGroup[0].id!,
                orgSlug: groupName,
              });
              await opts.keycloakClient.client.users.delFromGroup({
                id: user.id,
                groupId: devGroup.id!,
                realm: opts.keycloakRealm,
              });
              break;
            }
            case 'viewer': {
              const viewerGroup = await opts.keycloakClient.fetchViewerChildGroup({
                realm: opts.keycloakRealm,
                kcGroupId: organizationGroup[0].id!,
                orgSlug: groupName,
              });
              await opts.keycloakClient.client.users.delFromGroup({
                id: user.id,
                groupId: viewerGroup.id!,
                realm: opts.keycloakRealm,
              });
              break;
            }
            default: {
              throw new Error(`Role ${role} does not exist`);
            }
          }
        }

        await orgRepo.removeOrganizationMember({ organizationID: authContext.organizationId, userID: user.id });

        const userMemberships = await orgRepo.memberships({ userId: user.id });

        // delete the user only when user doesnt have any memberships
        // this will happen only when the user was invited but the user didnt login and the admin removed that user,
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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeInvitation: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<RemoveInvitationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const orgInvitationRepo = new OrganizationInvitationRepository(opts.db);
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

        // delete the user only when user doesnt have any memberships and pending invitations
        // this will happen only when the user was invited but the user didnt login and the admin removed that user,
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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    migrateFromApollo: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<MigrateFromApolloResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const userRepo = new UserRepository(opts.db);
        const orgRepo = new OrganizationRepository(opts.db);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);

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

        if (await fedGraphRepo.exists(graph.name)) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Federated graph '${graph.name}' already exists.`,
            },
            token: '',
          };
        }

        for await (const subgraph of graphDetails.subgraphs) {
          if (await subgraphRepo.exists(subgraph.name)) {
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
          const fedGraphRepo = new FederatedGraphRepository(tx, authContext.organizationId);
          const subgraphRepo = new SubgraphRepository(tx, authContext.organizationId);
          const compositionRepo = new GraphCompositionRepository(tx);
          const composer = new Composer(fedGraphRepo, subgraphRepo, compositionRepo);

          const federatedGraph = await apolloMigrator.migrateGraphFromApollo({
            fedGraph: {
              name: graph.name,
              routingURL: graphDetails.fedGraphRoutingURL || '',
            },
            subgraphs: graphDetails.subgraphs,
            organizationID: authContext.organizationId,
            db: tx,
          });

          const composition = await composer.composeFederatedGraph(federatedGraph);

          await composer.deployComposition(composition, authContext.userId);
        });

        const migratedGraph = await fedGraphRepo.byName(graph.name);
        if (!migratedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'Could not complete the migration. Please try again.',
            },
            token: '',
          };
        }

        orgWebhooks.send(OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED, {
          federated_graph: {
            id: migratedGraph.id,
            name: migratedGraph.name,
          },
          organization: {
            id: authContext.organizationId,
            slug: authContext.organizationSlug,
          },
          errors: false,
          actor_id: authContext.userId,
        });

        const tokenValue = await signJwt<GraphApiKeyJwtPayload>({
          secret: opts.jwtSecret,
          token: {
            iss: authContext.userId,
            federated_graph_id: migratedGraph.id,
            organization_id: authContext.organizationId,
          },
        });

        const token = await fedGraphRepo.createToken({
          token: tokenValue,
          federatedGraphId: migratedGraph.id,
          tokenName: migratedGraph.name,
          organizationId: authContext.organizationId,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateOrganizationWebhookConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateOrganizationWebhookConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteOrganizationWebhookConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await orgRepo.deleteWebhookConfig({
          organizationId: authContext.organizationId,
          ...req,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteOrganization: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteOrganizationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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

        // the personal org cannot be deleted
        if (org.isPersonal) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Personal organization cannot be deleted.`,
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

        await orgRepo.deleteOrganization(authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    leaveOrganization: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<LeaveOrganizationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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
        if (org.isPersonal && org.creatorUserId === (authContext.userId || req.userID)) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Creator of a personal organization cannot leave the organization.`,
            },
          };
        }

        // checking if the user is an single admin
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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateOrganizationDetails: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateOrganizationDetailsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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
                'Invalid slug. It must of 3-24 characters in length, start and end with an alphanumeric character and may contain hyphens in between.',
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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateOrgMemberRole: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateOrgMemberRoleResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const oidcRepo = new OidcRepository(opts.db);

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

        const adminChildGroup = await opts.keycloakClient.fetchAdminChildGroup({
          realm: opts.keycloakRealm,
          orgSlug: org.slug,
          kcGroupId: organizationGroups[0].id!,
        });

        const devChildGroup = await opts.keycloakClient.fetchDevChildGroup({
          realm: opts.keycloakRealm,
          orgSlug: org.slug,
          kcGroupId: organizationGroups[0].id!,
        });

        const viewerChildGroup = await opts.keycloakClient.fetchViewerChildGroup({
          realm: opts.keycloakRealm,
          orgSlug: org.slug,
          kcGroupId: organizationGroups[0].id!,
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

          await orgRepo.updateUserRole({
            organizationID: authContext.organizationId,
            orgMemberID: orgMember.orgMemberID,
            role: 'developer',
            previousRole: 'admin',
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteRouterTokenResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        const federatedGraph = await fedGraphRepo.byName(req.fedGraphName);
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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createIntegration: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateIntegrationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateIntegrationConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateIntegrationConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await orgRepo.updateIntegrationConfig({
          organizationId: authContext.organizationId,
          ...req,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    deleteIntegration: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteIntegrationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        if (!authContext.hasWriteAccess) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await orgRepo.deleteIntegration({
          organizationId: authContext.organizationId,
          id: req.id,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    createOIDCProvider: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateOIDCProviderResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteOIDCProviderResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<PublishPersistedOperationsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
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
        const federatedGraphRepo = new FederatedGraphRepository(opts.db, organizationId);

        // Validate everything before we update any data
        const schema = await federatedGraphRepo.getLatestValidSchemaVersion(req.fedGraphName);
        const federatedGraph = await federatedGraphRepo.byName(req.fedGraphName);
        if (!schema?.schema || federatedGraph === undefined) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' does not exist`,
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
          let status: PublishedOperationStatus;
          if (prev === undefined) {
            const data: PublishedOperationData = {
              version: 1,
              body: operation.contents,
            };
            opts.blobStorage.putObject(path, Buffer.from(JSON.stringify(data), 'utf8'));
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<AcceptOrDeclineInvitationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const userRepo = new UserRepository(opts.db);
        const orgInvitationRepo = new OrganizationInvitationRepository(opts.db);

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

          const devGroup = await opts.keycloakClient.fetchDevChildGroup({
            realm: opts.keycloakRealm,
            kcGroupId: organizationGroups[0].id!,
            orgSlug: groupName,
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
        } else {
          await orgInvitationRepo.removeInvite({ organizationId: req.organizationId, userId: user.id });
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    updateRBACSettings: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateRBACSettingsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        if (!authContext.isAdmin) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `The user doesnt have the permissions to perform this operation`,
            },
          };
        }

        await orgRepo.updateRBACSettings(authContext.organizationId, req.enable);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    addSubgraphMember: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<AddSubgraphMemberResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const userRepo = new UserRepository(opts.db);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        // TODO add a check to see if the user adding has permissions to add

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
        const subgraph = await subgraphRepo.byName(req.subgraphName);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph ${req.subgraphName} not found`,
            },
          };
        }

        await subgraphRepo.addSubgraphMember({ subgraphId: subgraph.id, userId: user.id });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    removeSubgraphMember: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<RemoveSubgraphMemberResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        // TODO add a check to see if the user adding has permissions to add

        // check if the subgraph exists
        const subgraph = await subgraphRepo.byName(req.subgraphName);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph ${req.subgraphName} not found`,
            },
          };
        }

        await subgraphRepo.removeSubgraphMember({ subgraphId: subgraph.id, subgraphMemberId: req.subgraphMemberId });

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetSubgraphsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const repo = new SubgraphRepository(opts.db, authContext.organizationId);

        const list = await repo.list({
          limit: req.limit,
          offset: req.offset,
        });

        return {
          graphs: list.map((g) => ({
            id: g.id,
            name: g.name,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            labels: g.labels,
          })),
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getSubgraphByName: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetSubgraphByNameResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const repo = new SubgraphRepository(opts.db, authContext.organizationId);

        const subgraph = await repo.byName(req.name);

        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.name}' not found`,
            },
          };
        }

        return {
          graph: {
            id: subgraph.id,
            name: subgraph.name,
            lastUpdatedAt: subgraph.lastUpdatedAt,
            routingURL: subgraph.routingUrl,
            labels: subgraph.labels,
          },
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphs: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetFederatedGraphsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const list = await fedGraphRepo.list({
          limit: req.limit,
          offset: req.offset,
        });

        let requestSeriesList: Record<string, PlainMessage<RequestSeriesItem>[]> = {};

        if (req.includeMetrics && opts.chClient) {
          const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
          requestSeriesList = await analyticsDashRepo.getListView(authContext.organizationId);
        }

        return {
          graphs: list.map((g) => ({
            id: g.id,
            name: g.name,
            labelMatchers: g.labelMatchers,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            connectedSubgraphs: g.subgraphsCount,
            compositionErrors: g.compositionErrors ?? '',
            isComposable: g.isComposable,
            requestSeries: requestSeriesList[g.id] ?? [],
          })),
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphSDLByName: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });
      return handleError<PlainMessage<GetFederatedGraphSDLByNameResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const schemaVersion = await fedRepo.getLatestValidSchemaVersion(req.name);
        if (schemaVersion && schemaVersion.schema) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            sdl: schemaVersion.schema,
          };
        }
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
        };
      });
    },

    getLatestValidSubgraphSDLByName: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });
      return handleError<PlainMessage<GetLatestValidSubgraphSDLByNameResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const subgraph = await subgraphRepo.byName(req.name);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        const schemaVersion = await subgraphRepo.getLatestValidSchemaVersion(req.name, req.fedGraphName);
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
        };
      });
    },

    getFederatedGraphByName: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetFederatedGraphByNameResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        const federatedGraph = await fedRepo.byName(req.name);

        if (!federatedGraph) {
          return {
            subgraphs: [],
            graphToken: '',
            graphRequestToken: '',
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
          };
        }

        let requestSeries: PlainMessage<RequestSeriesItem>[] = [];
        if (req.includeMetrics && opts.chClient) {
          const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
          const graphResponse = await analyticsDashRepo.getView(federatedGraph.id, authContext.organizationId);
          requestSeries = graphResponse.requestSeries;
        }

        const list = await subgraphRepo.listByFederatedGraph(req.name, { published: true });

        const routerRequestToken = await fedRepo.getGraphSignedToken({
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
        });

        if (!routerRequestToken) {
          return {
            subgraphs: [],
            graphToken: '',
            graphRequestToken: '',
            response: {
              code: EnumStatusCode.ERR,
              details: 'Router Request token not found',
            },
          };
        }

        const tokens = await fedRepo.getRouterTokens({
          organizationId: authContext.organizationId,
          federatedGraphId: federatedGraph.id,
          limit: 1,
        });

        let graphToken: GraphApiKeyDTO;

        if (tokens.length === 0) {
          const tokenValue = await signJwt<GraphApiKeyJwtPayload>({
            secret: opts.jwtSecret,
            token: {
              iss: authContext.userId,
              federated_graph_id: federatedGraph.id,
              organization_id: authContext.organizationId,
            },
          });

          graphToken = await fedRepo.createToken({
            token: tokenValue,
            federatedGraphId: federatedGraph.id,
            tokenName: federatedGraph.name,
            organizationId: authContext.organizationId,
          });
        } else {
          graphToken = tokens[0];
        }
        return {
          graph: {
            id: federatedGraph.id,
            name: federatedGraph.name,
            routingURL: federatedGraph.routingUrl,
            labelMatchers: federatedGraph.labelMatchers,
            lastUpdatedAt: federatedGraph.lastUpdatedAt,
            connectedSubgraphs: federatedGraph.subgraphsCount,
            compositionErrors: federatedGraph.compositionErrors ?? '',
            isComposable: federatedGraph.isComposable,
            requestSeries,
          },
          subgraphs: list.map((g) => ({
            id: g.id,
            name: g.name,
            routingURL: g.routingUrl,
            lastUpdatedAt: g.lastUpdatedAt,
            labels: g.labels,
          })),
          graphToken: graphToken.token,
          graphRequestToken: routerRequestToken,
          response: {
            code: EnumStatusCode.OK,
          },
        };
      });
    },

    getFederatedGraphChangelog: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetFederatedGraphChangelogResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedgraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);

        const federatedGraph = await fedgraphRepo.byName(req.name);
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
              details: 'Please provide pagination and datetange',
            },
            federatedGraphChangelogOutput: [],
            hasNextPage: false,
          };
        }

        const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });

        const { dateRange } = validateDateRanges({
          limit: orgLimits.changelogDataRetentionLimit,
          dateRange: req.dateRange,
        });

        const result = await fedgraphRepo.fetchFederatedGraphChangelog(
          federatedGraph.targetId,
          req.pagination,
          dateRange!,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetChecksByFederatedGraphNameResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedgraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);

        const federatedGraph = await fedgraphRepo.byName(req.name);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
            checks: [],
            checksCountBasedOnDateRange: '0',
            totalChecksCount: '0',
          };
        }

        const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });

        const { dateRange } = validateDateRanges({
          limit: orgLimits.breakingChangeRetentionLimit,
          dateRange: {
            start: req.startDate,
            end: req.endDate,
          } as DateRange,
        });

        const checksData = await subgraphRepo.checks({
          federatedGraphName: req.name,
          limit: req.limit,
          offset: req.offset,
          startDate: dateRange!.start,
          endDate: dateRange!.end,
        });
        const totalChecksCount = await subgraphRepo.getChecksCount({ federatedGraphName: req.name });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          checks: checksData.checks,
          checksCountBasedOnDateRange: checksData.checksCount.toString(),
          totalChecksCount: totalChecksCount.toString(),
        };
      });
    },

    getCheckSummary: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetCheckSummaryResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.graphName);

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
          };
        }

        const check = await subgraphRepo.checkById(req.checkId, graph.name);
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
          };
        }

        const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

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
        };
      });
    },

    getCheckOperations: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetCheckOperationsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.graphName);

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

        const check = await subgraphRepo.checkById(req.checkId, graph.name);
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

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          operations: affectedOperations.map((operation) => ({
            ...operation,
            firstSeenAt: operation.firstSeenAt.toUTCString(),
            lastSeenAt: operation.lastSeenAt.toUTCString(),
            impactingChanges: checkDetails.changes.filter(({ id }) => operation.schemaChangeIds.includes(id)),
          })),
          trafficCheckDays,
          createdAt: check.timestamp,
        };
      });
    },

    getCheckDetails: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetCheckDetailsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.graphName);

        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested graph does not exist',
            },
            changes: [],
            compositionErrors: [],
            trafficCheckDays: 0,
            createdAt: '',
          };
        }

        const check = await subgraphRepo.checkById(req.checkId, graph.name);
        const details = await subgraphRepo.checkDetails(req.checkId, graph.targetId);

        if (!check || !details) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check not found',
            },
            changes: [],
            compositionErrors: [],
            trafficCheckDays: 0,
            createdAt: '',
          };
        }

        const { trafficCheckDays } = await schemaCheckRepo.getFederatedGraphConfigForCheckId(req.checkId, graph.id);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          ...details,
          trafficCheckDays,
          createdAt: check?.timestamp,
        };
      });
    },

    getAnalyticsView: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetAnalyticsViewResponse>>(logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const analyticsRepo = new AnalyticsRequestViewRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.federatedGraphName);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
          };
        }

        const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });
        const { range, dateRange } = validateDateRanges({
          limit: orgLimits.tracingRetentionLimit,
          range: req.config?.range,
          dateRange: req.config?.dateRange,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          view: await analyticsRepo.getView(authContext.organizationId, graph.id, req.name, {
            ...req.config,
            range,
            dateRange,
          } as AnalyticsConfig),
        };
      });
    },

    getDashboardAnalyticsView: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetDashboardAnalyticsViewResponse>>(logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            mostRequestedOperations: [],
            requestSeries: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const graph = await fedGraphRepo.byName(req.federatedGraphName);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
            mostRequestedOperations: [],
            requestSeries: [],
          };
        }

        const { requestSeries, mostRequestedOperations } = await analyticsDashRepo.getView(
          graph.id,
          authContext.organizationId,
        );

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          mostRequestedOperations,
          requestSeries,
        };
      });
    },

    getGraphMetrics: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetGraphMetricsResponse>>(logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            filters: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const repo = new MetricsRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.federatedGraphName);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
            filters: [],
          };
        }

        const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });
        const { range, dateRange } = validateDateRanges({
          limit: orgLimits.analyticsRetentionLimit,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetMetricsErrorRateResponse>>(logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            series: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const repo = new MetricsRepository(opts.chClient);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);

        const graph = await fedGraphRepo.byName(req.federatedGraphName);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
            series: [],
          };
        }

        const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });
        const { range, dateRange } = validateDateRanges({
          limit: orgLimits.analyticsRetentionLimit,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetTraceResponse>>(logger, async () => {
        if (!opts.chClient) {
          return {
            response: {
              code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
            },
            spans: [],
          };
        }
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOrganizationMembersResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const orgInvitationRepo = new OrganizationInvitationRepository(opts.db);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const federatedGraph = await fedGraphRepo.byName(req.graphName);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetAPIKeysResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<WhoAmIResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOrganizationWebhookConfigsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOrganizationWebhookMetaResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        const eventsMeta = await orgRepo.getWebhookMeta(req.id, authContext.organizationId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          eventsMeta,
        };
      });
    },

    getRouterTokens: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetRouterTokensResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const federatedGraph = await fedRepo.byName(req.fedGraphName);
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
          tokens,
        };
      });
    },

    getOrganizationIntegrations: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOrganizationIntegrationsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<IsGitHubAppInstalledResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepository = new OrganizationRepository(opts.db);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetFieldUsageResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const federatedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

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

        const graph = await federatedGraphRepo.byName(req.graphName);
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

        const { clients, requestSeries, meta } = await usageRepo.getFieldUsage({
          federatedGraphId: graph.id,
          organizationId: authContext.organizationId,
          typename: req.typename,
          field: req.field,
          namedType: req.namedType,
          range: req.range,
          dateRange: req.dateRange,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOperationContentResponse>>(logger, async () => {
        await opts.authenticator.authenticate(ctx.requestHeader);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOIDCProviderResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetPersistedOperationsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const federatedGraph = await fedRepo.byName(req.federatedGraphName);

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

    getClients: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetClientsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const federatedGraph = await fedRepo.byName(req.fedGraphName);
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetOrganizationRequestsCountResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetInvitationsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgInvitationRepo = new OrganizationInvitationRepository(opts.db);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          invitations: await orgInvitationRepo.getPendingInvitationsOfUser({ userId: authContext.userId }),
        };
      });
    },

    getCompositions: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetCompositionsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const orgRepo = new OrganizationRepository(opts.db);
        const graphCompositionRepository = new GraphCompositionRepository(opts.db);

        const federatedGraph = await fedRepo.byName(req.fedGraphName);

        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.fedGraphName}' does not exist`,
            },
            compositions: [],
          };
        }

        const orgLimits = await orgRepo.getOrganizationLimits({ organizationID: authContext.organizationId });

        const { dateRange } = validateDateRanges({
          limit: orgLimits.analyticsRetentionLimit,
          dateRange: {
            start: req.startDate,
            end: req.endDate,
          } as DateRange,
        });

        const compositions = await graphCompositionRepository.getGraphCompositions({
          fedGraphTargetId: federatedGraph.targetId,
          organizationId: authContext.organizationId,
          limit: req.limit,
          offset: req.offset,
          startDate: dateRange!.start,
          endDate: dateRange!.end,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          compositions,
        };
      });
    },

    getCompositionDetails: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetCompositionDetailsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const compositionRepo = new GraphCompositionRepository(opts.db);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetSdlBySchemaVersionResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const sdl = await fedRepo.getSdlBasedOnSchemaVersion({
          graphName: req.graphName,
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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetChangelogBySchemaVersionResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

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
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetUserAccessibleResourcesResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

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
            })),
            subgraphs: subgraphs.map((g) => ({
              targetId: g.targetId,
              name: g.name,
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
          })),
          subgraphs: subgraphs.map((g) => ({
            targetId: g.targetId,
            name: g.name,
          })),
        };
      });
    },

    getSubgraphMembers: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetSubgraphMembersResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        // check if the subgraph exists
        const subgraph = await subgraphRepo.byName(req.subgraphName);
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

    isRBACEnabled: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<IsRBACEnabledResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        const organization = await orgRepo.byId(authContext.organizationId);
        if (!organization) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
            enabled: false,
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          enabled: organization.isRBACEnabled || false,
        };
      });
    },
  };
}
