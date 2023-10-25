import { PlainMessage } from '@bufbuild/protobuf';
import { ServiceImpl } from '@connectrpc/connect';
import { EnumStatusCode, GraphQLSubscriptionProtocol } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetConfigResponse } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import {
  CheckFederatedGraphResponse,
  CheckSubgraphSchemaResponse,
  CompositionError,
  CreateAPIKeyResponse,
  CreateFederatedGraphResponse,
  CreateFederatedGraphTokenResponse,
  CreateFederatedSubgraphResponse,
  CreateIntegrationResponse,
  CreateOrganizationWebhookConfigResponse,
  DeleteAPIKeyResponse,
  DeleteFederatedGraphResponse,
  DeleteFederatedSubgraphResponse,
  DeleteIntegrationResponse,
  DeleteRouterTokenResponse,
  FixSubgraphSchemaResponse,
  ForceCheckSuccessResponse,
  GetAPIKeysResponse,
  GetAnalyticsViewResponse,
  GetCheckDetailsResponse,
  GetChecksByFederatedGraphNameResponse,
  GetDashboardAnalyticsViewResponse,
  GetFederatedGraphByNameResponse,
  GetFederatedGraphChangelogResponse,
  GetFederatedGraphSDLByNameResponse,
  GetFederatedGraphsResponse,
  GetGraphMetricsResponse,
  GetMetricsErrorRateResponse,
  GetOrganizationIntegrationsResponse,
  GetOrganizationMembersResponse,
  GetOrganizationWebhookConfigsResponse,
  GetOrganizationWebhookMetaResponse,
  GetRouterTokensResponse,
  GetSubgraphByNameResponse,
  GetSubgraphsResponse,
  GetTraceResponse,
  InviteUserResponse,
  IsGitHubAppInstalledResponse,
  MigrateFromApolloResponse,
  PublishFederatedSubgraphResponse,
  RemoveInvitationResponse,
  RequestSeriesItem,
  UpdateFederatedGraphResponse,
  UpdateIntegrationConfigResponse,
  UpdateOrganizationDetailsResponse,
  UpdateOrganizationWebhookConfigResponse,
  UpdateSubgraphResponse,
  WhoAmIResponse,
  GetFieldUsageResponse,
  GetFederatedSubgraphSDLByNameResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

import { OrganizationEventName, PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { OpenAIGraphql, isValidUrl } from '@wundergraph/cosmo-shared';
import { parse } from 'graphql';
import { GraphApiKeyDTO, GraphApiKeyJwtPayload } from '../../types/index.js';
import { Composer } from '../composition/composer.js';
import { buildSchema, composeSubgraphs } from '../composition/composition.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';
import { signJwt } from '../crypto/jwt.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { GitHubRepository } from '../repositories/GitHubRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../repositories/SchemaCheckRepository.js';
import { Subgraph, SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { AnalyticsDashboardViewRepository } from '../repositories/analytics/AnalyticsDashboardViewRepository.js';
import { AnalyticsRequestViewRepository } from '../repositories/analytics/AnalyticsRequestViewRepository.js';
import { MetricsRepository } from '../repositories/analytics/MetricsRepository.js';
import { TraceRepository } from '../repositories/analytics/TraceRepository.js';
import type { RouterOptions } from '../routes.js';
import { ApiKeyGenerator } from '../services/ApiGenerator.js';
import ApolloMigrator from '../services/ApolloMigrator.js';
import Slack from '../services/Slack.js';
import { UsageRepository } from '../repositories/analytics/UsageRepository.js';
import { formatSubscriptionProtocol, handleError, isValidLabelMatchers, isValidLabels } from '../util.js';
import { FederatedGraphSchemaUpdate, OrganizationWebhookService } from '../webhooks/OrganizationWebhookService.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof PlatformService>> {
  return {
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
          const compChecker = new Composer(fedGraphRepo, subgraphRepo);
          const composition = await compChecker.composeFederatedGraph(federatedGraph.name, federatedGraph.targetId);

          compositionErrors.push(
            ...composition.errors.map((e) => ({
              federatedGraphName: federatedGraph.name,
              message: e.message,
            })),
          );

          await compChecker.deployComposition(composition);
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
        const repo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const sdl = await repo.getLatestValidSdlOfFederatedGraph(req.name);
        if (sdl) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            sdl,
          };
        }
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
        };
      });
    },

    getFederatedSubgraphSDLByName: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });
      return handleError<PlainMessage<GetFederatedSubgraphSDLByNameResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const subgraph = await subgraphRepo.byName(req.name);
        if (subgraph?.schemaSDL) {
          return {
            response: {
              code: EnumStatusCode.OK,
            },
            sdl: subgraph.schemaSDL,
          };
        }
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
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

        const tokens = await fedRepo.getRouterTokens({
          organizationId: authContext.organizationId,
          federatedGraphId: federatedGraph.id,
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

        const newSchemaSDL = new TextDecoder().decode(req.schema);

        const schemaCheckID = await schemaCheckRepo.create({
          targetId: subgraph.targetId,
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

        // add the changes to the db
        await schemaCheckRepo.createSchemaCheckChanges({
          changes: [...schemaChanges.breakingChanges, ...schemaChanges.nonBreakingChanges],
          schemaCheckID,
        });

        if (schemaChanges.breakingChanges.length > 0) {
          await schemaCheckRepo.update({
            schemaCheckID,
            hasBreakingChanges: true,
          });
        }

        const composer = new Composer(fedGraphRepo, subgraphRepo);
        const result = await composer.composeWithProposedSDL(subgraph.labels, subgraph.name, newSchemaSDL);

        await schemaCheckRepo.createSchemaCheckCompositions({
          schemaCheckID,
          compositions: result.compositions,
        });

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

        if (req.gitInfo && opts.githubApp) {
          const githubRepo = new GitHubRepository(opts.db, opts.githubApp);
          await githubRepo.createCommitCheck({
            schemaCheckID,
            gitInfo: req.gitInfo,
            compositionErrors,
            breakingChangesCount: schemaChanges.breakingChanges.length,
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
        const compChecker = new Composer(fedGraphRepo, subgraphRepo);

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

    getFederatedGraphChangelog: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetFederatedGraphChangelogResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedgraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);

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

        const result = await fedgraphRepo.fetchFederatedGraphChangelog(
          federatedGraph.targetId,
          req.pagination,
          req.dateRange,
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

        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const checksData = await subgraphRepo.checks({
          federatedGraphName: req.name,
          limit: req.limit,
          offset: req.offset,
          startDate: req.startDate,
          endDate: req.endDate,
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

    getCheckDetails: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<GetCheckDetailsResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

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

        const details = await subgraphRepo.checkDetails(req.checkID, graph.targetId, graph.name);

        if (!details) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check not found',
            },
            changes: [],
            compositionErrors: [],
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          ...details,
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

        const details = await subgraphRepo.checkDetails(req.checkId, graph.targetId, graph.name);

        if (!details) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: 'Requested check does not exist',
            },
            changes: [],
            compositionErrors: [],
          };
        }

        const githubDetails = await subgraphRepo.forceCheckSuccess(details.check.id);

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

        const federatedGraph = await fedGraphRepo.byName(req.name);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
          };
        }

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
          const composer = new Composer(fedGraphRepo, subgraphRepo);

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
            const composition = await composer.composeFederatedGraph(federatedGraph.name, federatedGraph.targetId);

            await composer.deployComposition(composition);

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
        const subgraphRepository = new SubgraphRepository(opts.db, authContext.organizationId);

        const subgraph = await subgraphRepository.byName(req.name);
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

        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const orgWebhooks = new OrganizationWebhookService(opts.db, authContext.organizationId, opts.logger);

        const { compositionErrors, updatedFederatedGraphs } = await subgraphRepo.update({
          name: req.name,
          labels: req.labels,
          subscriptionUrl: req.subscriptionUrl,
          routingUrl: req.routingUrl,
          subscriptionProtocol: req.subscriptionProtocol
            ? formatSubscriptionProtocol(req.subscriptionProtocol)
            : undefined,
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

        const graph = await fedGraphRepo.byName(req.federatedGraphName);
        if (!graph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.federatedGraphName}' not found`,
            },
          };
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          view: await analyticsRepo.getView(authContext.organizationId, graph.id, req.name, req.config),
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

        const view = await repo.getMetricsView({
          range: req.range,
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

        const metrics = await repo.getErrorsView({
          range: req.range,
          filters: req.filters,
          organizationId: authContext.organizationId,
          graphId: graph.id,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          series: metrics.errorRate.series,
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

        const orgMembers = await orgRepo.getMembers({ organizationID: authContext.organizationId });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          members: orgMembers,
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

        await opts.keycloakClient.authenticateClient();

        const user = await userRepo.byEmail(req.email);
        if (user) {
          const orgMember = await orgRepo.getOrganizationMember({
            organizationID: authContext.organizationId,
            userID: user.id,
          });
          if (orgMember && !orgMember.acceptedInvite) {
            await opts.keycloakClient.executeActionsEmail({
              userID: user.id,
              redirectURI: `${process.env.WEB_BASE_URL}/login`,
              realm: opts.keycloakRealm,
            });

            return {
              response: {
                code: EnumStatusCode.OK,
                details: 'Invited member successfully.',
              },
            };
          } else if (orgMember && orgMember.acceptedInvite) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `${req.email} is already a member of this organization`,
              },
            };
          }
          const userMemberships = await orgRepo.memberships({
            userId: user.id,
          });
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

        const groupName = organization.slug;

        const organizationGroup = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: groupName,
          realm: opts.keycloakRealm,
        });

        if (organizationGroup.length === 0) {
          throw new Error(`Organization group '${groupName}' not found`);
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

        const userGroups = await opts.keycloakClient.client.users.listGroups({
          search: groupName,
          realm: opts.keycloakRealm,
          id: keycloakUserID!,
          max: 1,
        });

        if (userGroups.length === 0) {
          // By default, all invited users are added to the top-level organization group
          // This is the at least privilege approach
          await opts.keycloakClient.client.users.addToGroup({
            id: keycloakUserID!,
            groupId: organizationGroup[0].id!,
            realm: opts.keycloakRealm,
          });
        }

        await opts.keycloakClient.executeActionsEmail({
          userID: keycloakUserID!,
          redirectURI: `${process.env.WEB_BASE_URL}/login`,
          realm: opts.keycloakRealm,
        });

        // TODO: rate limit this
        await userRepo.inviteUser({
          email: req.email,
          keycloakUserID: keycloakUserID!,
          organizationID: authContext.organizationId,
          dbUser: user,
        });

        return {
          response: {
            code: EnumStatusCode.OK,
            details: 'Invited member successfully.',
          },
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
        const orgRepo = new OrganizationRepository(opts.db);

        const apiKeys = await orgRepo.getAPIKeys({ organizationID: authContext.organizationId });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          apiKeys,
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
        const orgRepo = new OrganizationRepository(opts.db);
        const keyName = req.name.trim();

        const apiKeyModel = await orgRepo.getAPIKeyByName({
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

        await orgRepo.addAPIKey({
          name: keyName,
          organizationID: authContext.organizationId,
          userID: authContext.userId || req.userID,
          key: generatedAPIKey,
          expiresAt: req.expires,
        });
        return {
          response: {
            code: EnumStatusCode.OK,
          },
          apiKey: generatedAPIKey,
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

    deleteAPIKey: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<DeleteAPIKeyResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

        const apiKey = await orgRepo.getAPIKeyByName({ organizationID: authContext.organizationId, name: req.name });
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

        await orgRepo.removeAPIKey({
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

    removeInvitation: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<RemoveInvitationResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const userRepo = new UserRepository(opts.db);

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

        await opts.keycloakClient.authenticateClient();

        const organizationGroup = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: org.slug,
          realm: opts.keycloakRealm,
        });

        if (organizationGroup.length === 0) {
          throw new Error(`Organization group '${org.slug}' not found`);
        }

        await opts.keycloakClient.client.users.delFromGroup({
          id: user.id,
          groupId: organizationGroup[0].id!,
          realm: opts.keycloakRealm,
        });

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
          const composer = new Composer(fedGraphRepo, subgraphRepo);

          const federatedGraph = await apolloMigrator.migrateGraphFromApollo({
            fedGraph: {
              name: graph.name,
              routingURL: graphDetails.fedGraphRoutingURL || '',
            },
            subgraphs: graphDetails.subgraphs,
            organizationID: authContext.organizationId,
            db: tx,
          });

          const composition = await composer.composeFederatedGraph(federatedGraph.name, federatedGraph.targetId);

          await composer.deployComposition(composition);
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

    updateOrganizationWebhookConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(logger, async () => {
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

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(logger, async () => {
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

      return handleError<PlainMessage<UpdateOrganizationWebhookConfigResponse>>(logger, async () => {
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

        // non admins cannot update the role of an org member
        if (!user.roles.includes('admin')) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not have the permissions to the role of an organization member.',
            },
          };
        }

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
        });

        if (users.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'User does not exist.',
            },
          };
        }

        const organizationGroup = await opts.keycloakClient.client.groups.find({
          max: 1,
          search: org.slug,
          realm: opts.keycloakRealm,
          briefRepresentation: false,
        });

        if (organizationGroup.length === 0) {
          throw new Error(`Organization group '${org.slug}' not found`);
        }

        const childGroups = await opts.keycloakClient.client.groups.find({
          search: 'admin',
          realm: opts.keycloakRealm,
        });

        if (childGroups.length === 0) {
          throw new Error(`Organization group '${org.slug}' does not have any child groups`);
        }

        const childGroup = childGroups.find((group) => group.id === organizationGroup[0].id)?.subGroups?.[0];

        if (!childGroup) {
          throw new Error(`Organization group '${org.slug}' does not have any child groups`);
        }

        if (req.role === 'admin') {
          await opts.keycloakClient.client.users.delFromGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: organizationGroup[0].id!,
          });

          await opts.keycloakClient.client.users.addToGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: childGroup.id!,
          });

          await orgRepo.updateUserRole({
            organizationID: authContext.organizationId,
            orgMemberID: orgMember.orgMemberID,
            role: 'admin',
          });
        } else {
          await opts.keycloakClient.client.users.addToGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: organizationGroup[0].id!,
          });

          await opts.keycloakClient.client.users.delFromGroup({
            id: users[0].id!,
            realm: opts.keycloakRealm,
            groupId: childGroup.id!,
          });

          await orgRepo.updateUserRole({
            organizationID: authContext.organizationId,
            orgMemberID: orgMember.orgMemberID,
            role: 'member',
          });
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
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
        });

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          tokens,
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

    updateIntegrationConfig: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<UpdateIntegrationConfigResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);

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
          range: req.range,
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
  };
}
