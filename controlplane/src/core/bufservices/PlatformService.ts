import { ServiceImpl } from '@bufbuild/connect';
import { JsonValue, PlainMessage } from '@bufbuild/protobuf';
import { parse } from 'graphql';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { GetConfigResponse } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import {
  CheckFederatedGraphResponse,
  CheckSubgraphSchemaResponse,
  CompositionError,
  CreateAPIKeyResponse,
  CreateFederatedGraphResponse,
  CreateFederatedGraphTokenResponse,
  CreateFederatedSubgraphResponse,
  DeleteAPIKeyResponse,
  DeleteFederatedGraphResponse,
  DeleteFederatedSubgraphResponse,
  FederatedGraphChangelog,
  FederatedGraphChangelogOutput,
  FixSubgraphSchemaResponse,
  GetAnalyticsViewResponse,
  GetAPIKeysResponse,
  GetCheckDetailsResponse,
  GetChecksByFederatedGraphNameResponse,
  GetDashboardAnalyticsViewResponse,
  GetFederatedGraphByNameResponse,
  GetFederatedGraphChangelogResponse,
  GetFederatedGraphSDLByNameResponse,
  GetFederatedGraphsResponse,
  GetOrganizationMembersResponse,
  GetSubgraphByNameResponse,
  GetSubgraphsResponse,
  GetTraceResponse,
  InviteUserResponse,
  PublishFederatedSubgraphResponse,
  RemoveInvitationResponse,
  RequestSeriesItem,
  UpdateFederatedGraphResponse,
  UpdateSubgraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { buildRouterConfig, OpenAIGraphql } from '@wundergraph/cosmo-shared';
import { GraphApiKeyJwtPayload } from '../../types/index.js';
import { Composer } from '../composition/composer.js';
import { buildSchema, composeSubgraphs } from '../composition/composition.js';
import { getDiffBetweenGraphs } from '../composition/schemaCheck.js';
import { updateComposedSchema } from '../composition/updateComposedSchema.js';
import { signJwt } from '../crypto/jwt.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { SchemaCheckRepository } from '../repositories/SchemaCheckRepository.js';
import { SubgraphRepository } from '../repositories/SubgraphRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { AnalyticsDashboardViewRepository } from '../repositories/analytics/AnalyticsDashboardViewRepository.js';
import { AnalyticsRequestViewRepository } from '../repositories/analytics/AnalyticsRequestViewRepository.js';
import { TraceRepository } from '../repositories/analytics/TraceRepository.js';
import type { RouterOptions } from '../routes.js';
import { ApiKeyGenerator } from '../services/ApiGenerator.js';
import { handleError, isValidLabelMatchers, isValidLabels } from '../util.js';
import ApolloMigrator from '../services/ApolloMigrator.js';

export default function (opts: RouterOptions): Partial<ServiceImpl<typeof PlatformService>> {
  return {
    createFederatedGraph: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CreateFederatedGraphResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);

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

        const subgraphs = await subgraphRepo.listByGraph(req.name, {
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

        const compositionErrors = await updateComposedSchema({
          federatedGraph,
          fedGraphRepo,
          subgraphRepo,
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
        const repo = new SubgraphRepository(opts.db, authContext.organizationId);

        if (await repo.exists(req.name)) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Subgraph '${req.name}' already exists`,
            },
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

        await repo.create({
          name: req.name,
          labels: req.labels,
          routingUrl: req.routingUrl,
        });

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
        const repo = new FederatedGraphRepository(opts.db, authContext.organizationId);

        const list = await repo.list({
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
            name: g.name,
            labelMatchers: g.labelMatchers,
            routingURL: g.routingUrl,
            isComposable: g.isComposable,
            compositionErrors: g.compositionErrors ?? '',
            lastUpdatedAt: g.lastUpdatedAt,
            connectedSubgraphs: g.subgraphsCount,
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
        const sdl = await repo.getLatestSdlOfFederatedGraph(req.name);
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
      return handleError<PlainMessage<GetFederatedGraphSDLByNameResponse>>(logger, async () => {
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

        const list = await subgraphRepo.listByGraph(req.name);

        return {
          graph: {
            name: federatedGraph.name,
            routingURL: federatedGraph.routingUrl,
            labelMatchers: federatedGraph.labelMatchers,
            isComposable: federatedGraph.isComposable,
            compositionErrors: federatedGraph.compositionErrors ?? '',
            lastUpdatedAt: federatedGraph.lastUpdatedAt,
            connectedSubgraphs: federatedGraph.subgraphsCount,
            requestSeries,
          },
          subgraphs: list.map((g) => ({
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

    checkSubgraphSchema: (req, ctx) => {
      const logger = opts.logger.child({
        service: ctx.service.typeName,
        method: ctx.method.name,
      });

      return handleError<PlainMessage<CheckSubgraphSchemaResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const schemaCheckRepo = new SchemaCheckRepository(opts.db);
        const subgraph = await subgraphRepo.byName(req.subgraphName);
        const compChecker = new Composer(fedGraphRepo, subgraphRepo);

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

        const result = await compChecker.composeWithProposedSDL(subgraph.labels, subgraph.name, newSchemaSDL);

        await schemaCheckRepo.createSchemaCheckCompositions({
          schemaCheckID,
          compositions: result.compositions,
        });

        const compositionErrors: CompositionError[] = [];
        for (const composition of result.compositions) {
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
              } as CompositionError);
            }
          }
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

        const compositionErrors: CompositionError[] = [];
        for (const composition of result.compositions) {
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
              } as CompositionError);
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
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const compChecker = new Composer(fedGraphRepo, subgraphRepo);
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

        const subgraphSchemaSDL = new TextDecoder().decode(req.schema);

        try {
          // Here we check if the schema is valid as a subgraph
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

        // We store the schema in the database, only when the schema is valid
        // Update it before composing the federated graph to include the latest schema
        const updatedSubgraph = await subgraphRepo.updateSchema(subgraph.name, subgraphSchemaSDL);
        if (!updatedSubgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Subgraph '${req.name}' could not be updated`,
            },
            compositionErrors: [],
          };
        }

        const result = await compChecker.compose(updatedSubgraph.labels);
        for await (const composedGraph of result.compositions) {
          const currentFederatedSDL = await fedGraphRepo.getLatestSdlOfFederatedGraph(composedGraph.name);

          /**
           * Build router config when composed schema is valid
           */
          const hasErrors = composedGraph.errors.length > 0;

          let routerConfigJson: JsonValue = null;
          if (!hasErrors && composedGraph.composedSchema) {
            const routerConfig = buildRouterConfig({
              argumentConfigurations: composedGraph.argumentConfigurations,
              federatedSDL: composedGraph.composedSchema,
              subgraphs: composedGraph.subgraphs,
            });
            routerConfigJson = routerConfig.toJson();
          }

          // We always create a new version in the database, but
          // we might mark versions with compositions errors as not composable
          // The routerConfig is stored along with the valid composed schema
          const federatedGraph = await fedGraphRepo.updateSchema({
            graphName: composedGraph.name,
            // passing the old schema if the current composed schema is empty due to composition errors
            composedSDL: composedGraph.composedSchema || currentFederatedSDL || undefined,
            compositionErrors: composedGraph.errors,
            routerConfig: routerConfigJson,
          });

          if (composedGraph.composedSchema && federatedGraph?.composedSchemaVersionId) {
            const schemaChanges = await getDiffBetweenGraphs(currentFederatedSDL || '', composedGraph.composedSchema);

            if (schemaChanges.kind !== 'failure') {
              await fedGraphRepo.createFederatedGraphChangelog({
                schemaVersionID: federatedGraph.composedSchemaVersionId,
                changes: schemaChanges.changes,
              });
            }
          }
        }

        // pass the composition errors and show it to the user
        const compositionErrors: CompositionError[] = [];
        for (const composition of result.compositions) {
          if (composition.errors.length > 0) {
            for (const error of composition.errors) {
              compositionErrors.push({
                message: error.message,
                federatedGraphName: composition.name,
              } as CompositionError);
            }
          }
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
          };
        }

        const dbChangelogs = await fedgraphRepo.fetchFederatedGraphChangelog(federatedGraph.targetId);

        if (!dbChangelogs) {
          return {
            federatedGraphChangelogOutput: [],
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
            },
          };
        }

        // dbChangelogs are not grouped based on schemaVersionID
        const groupedChangelog: {
          [key: string]: FederatedGraphChangelog[];
        } = {};

        for (const log of dbChangelogs) {
          const schemaVersionId = log.schemaVersionId;

          if (groupedChangelog[schemaVersionId]) {
            groupedChangelog[schemaVersionId].push({
              id: log.id,
              path: log.path,
              changeType: log.changeType,
              changeMessage: log.changeMessage,
              createdAt: log.createdAt,
            } as FederatedGraphChangelog);
          } else {
            groupedChangelog[schemaVersionId] = [
              {
                id: log.id,
                path: log.path,
                changeType: log.changeType,
                changeMessage: log.changeMessage,
                createdAt: log.createdAt,
              } as FederatedGraphChangelog,
            ];
          }
        }

        const federatedGraphChangelogOutput: FederatedGraphChangelogOutput[] = Object.keys(groupedChangelog).map(
          (schemaVersionId) => {
            return {
              createdAt: groupedChangelog[schemaVersionId][0].createdAt,
              schemaVersionId,
              changelogs: groupedChangelog[schemaVersionId],
            } as FederatedGraphChangelogOutput;
          },
        );

        return {
          federatedGraphChangelogOutput,
          response: {
            code: EnumStatusCode.OK,
          },
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
          };
        }

        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const checks = await subgraphRepo.checks(req.name);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          checks,
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

        const details = await subgraphRepo.checkDetails(req.checkID, graph.targetId);

        return {
          response: {
            code: EnumStatusCode.OK,
          },
          ...details,
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
        const fedgraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        const federatedGraph = await fedgraphRepo.byName(req.name);
        if (!federatedGraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Federated graph '${req.name}' not found`,
            },
          };
        }

        const subgraphsTargetIDs: string[] = [];
        const subgraphs = await subgraphRepo.listByGraph(req.name);
        for (const subgraph of subgraphs) {
          subgraphsTargetIDs.push(subgraph.targetId);
        }

        await fedgraphRepo.delete(federatedGraph.targetId, subgraphsTargetIDs);

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
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);
        const compChecker = new Composer(fedGraphRepo, subgraphRepo);

        const subgraph = await subgraphRepo.byName(req.subgraphName);
        if (!subgraph) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Subgraph '${req.subgraphName}' not found`,
            },
          };
        }

        await subgraphRepo.delete(subgraph.targetId);

        const result = await compChecker.compose(subgraph.labels);
        for await (const composedGraph of result.compositions) {
          let currentFederatedSDL: string | undefined | null;
          if (composedGraph.composedSchema) {
            currentFederatedSDL = await fedGraphRepo.getLatestSdlOfFederatedGraph(composedGraph.name);
          }

          /**
           * Build router config when composed schema is valid
           */
          const hasErrors = composedGraph.errors.length > 0;

          let routerConfigJson: JsonValue = null;
          if (!hasErrors && composedGraph.composedSchema) {
            const routerConfig = buildRouterConfig({
              argumentConfigurations: composedGraph.argumentConfigurations,
              subgraphs: composedGraph.subgraphs,
              federatedSDL: composedGraph.composedSchema,
            });
            routerConfigJson = routerConfig.toJson();
          }

          // We always create a new version in the database, but
          // we might mark versions with compositions errors as not composable
          // The routerConfig is stored along with the valid composed schema
          const federatedGraph = await fedGraphRepo.updateSchema({
            graphName: composedGraph.name,
            composedSDL: composedGraph.composedSchema || undefined,
            compositionErrors: composedGraph.errors,
            routerConfig: routerConfigJson,
          });

          if (composedGraph.composedSchema && federatedGraph?.composedSchemaVersionId) {
            const schemaChanges = await getDiffBetweenGraphs(currentFederatedSDL || '', composedGraph.composedSchema);

            if (schemaChanges.kind !== 'failure') {
              await fedGraphRepo.createFederatedGraphChangelog({
                schemaVersionID: federatedGraph.composedSchemaVersionId,
                changes: schemaChanges.changes,
              });
            }
          }
        }

        return {
          response: {
            code: EnumStatusCode.OK,
          },
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

        const exists = await fedGraphRepo.exists(req.name);
        if (!exists) {
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

        const compositionErrors = await fedGraphRepo.update({
          name: req.name,
          labelMatchers: req.labelMatchers,
          routingUrl: req.routingUrl,
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
        const repo = new SubgraphRepository(opts.db, authContext.organizationId);

        const exists = await repo.exists(req.name);
        if (!exists) {
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

        const compositionErrors = await repo.update({
          name: req.name,
          labels: req.labels,
          routingUrl: req.routingUrl,
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
          name: s.name,
          routingURL: s.routingUrl,
          labels: s.labels,
          lastUpdatedAt: s.lastUpdatedAt,
        }));

        const result = composeSubgraphs(
          subgraphs.map((s) => ({
            name: s.name,
            url: s.routingUrl,
            definitions: parse(s.schemaSDL),
          })),
        );

        if (result.errors) {
          const compositionErrors: CompositionError[] = [];
          for (const error of result.errors) {
            compositionErrors.push({
              message: error.message,
              federatedGraphName: req.name,
            } as CompositionError);
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
          if (userMemberships.length > 0) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `${req.email} is already a member of another organization`,
              },
            };
          }
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
        const config = await fedGraphRepo.getLatestValidRouterConfig(req.graphName);

        if (!config) {
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
          config: {
            engineConfig: config.config.engineConfig,
            version: config.version,
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

        // deleting the user from keycloak
        await opts.keycloakClient.client.users.del({
          id: user.id,
          realm: opts.keycloakRealm,
        });
        // deleting the user from the db
        await userRepo.deleteUser({ id: user.id });

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

      return handleError<PlainMessage<DeleteAPIKeyResponse>>(logger, async () => {
        const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
        const orgRepo = new OrganizationRepository(opts.db);
        const fedGraphRepo = new FederatedGraphRepository(opts.db, authContext.organizationId);
        const subgraphRepo = new SubgraphRepository(opts.db, authContext.organizationId);

        const org = await orgRepo.byId(authContext.organizationId);
        if (!org) {
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `Organization not found`,
            },
          };
        }

        const apolloMigrator = new ApolloMigrator({ apiKey: req.apiKey, organizationSlug: org.slug });

        const graph = await apolloMigrator.fetchGraphID();
        const graphDetails = await apolloMigrator.fetchGraphDetails({ graphID: graph.id, variantName: 'main' });

        if (await fedGraphRepo.exists(graph.name)) {
          return {
            response: {
              code: EnumStatusCode.ERR_ALREADY_EXISTS,
              details: `Federated graph '${graph.name}' already exists.`,
            },
          };
        }

        for (const subgraph of graphDetails.subgraphs) {
          if (await subgraphRepo.exists(subgraph.name)) {
            return {
              response: {
                code: EnumStatusCode.ERR_ALREADY_EXISTS,
                details: `Subgraph '${subgraph.name}' already exists`,
              },
            };
          }
        }

        const federatedGraph = await apolloMigrator.migrateGraphFromApollo({
          fedGraph: {
            name: graph.name,
            routingURL: graphDetails.fedGraphRoutingURL,
          },
          subgraphs: graphDetails.subgraphs,
          organizationID: authContext.organizationId,
          db: opts.db,
        });

        const compositionErrors = await updateComposedSchema({
          federatedGraph,
          fedGraphRepo,
          subgraphRepo,
        });

        if (compositionErrors.length > 0) {
          return {
            response: {
              code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
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
  };
}
