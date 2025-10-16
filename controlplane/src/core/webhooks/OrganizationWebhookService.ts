import { PlainMessage } from '@bufbuild/protobuf';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import { v4 } from 'uuid';
import * as schema from '../../db/schema.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { WebhookDeliveryInfo } from '../../db/models.js';
import { webhookAxiosRetryCond } from '../util.js';
import {
  FederatedGraphDTO, Label,
  LintIssueResult,
  NamespaceDTO,
  SchemaGraphPruningIssues,
  SchemaLintIssues,
  SubgraphDTO,
} from '../../types/index.js';
import { LintSeverity, VCSContext } from '../../../../connect/src/wg/cosmo/platform/v1/platform_pb.js';
import { ComposedFederatedGraph } from '../composition/composer.js';
import { GetDiffBetweenGraphsSuccess } from '../composition/schemaCheck.js';
import { SubgraphCheckExtensionsRepository } from '../repositories/SubgraphCheckExtensionsRepository.js';
import { BlobStorage } from '../blobstorage/index.js';
import { audiences, nowInSeconds, signJwtHS256 } from '../crypto/jwt.js';
import { InspectorOperationResult } from '../services/SchemaUsageTrafficInspector.js';
import { makeWebhookRequest } from './utils.js';

export interface FederatedGraphSchemaUpdate {
  eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED;
  payload: {
    federated_graph: {
      id: string;
      name: string;
      namespace: string;
    };
    organization: {
      id: string;
      slug: string;
    };
    errors: boolean;
    actor_id?: string;
  };
}

export interface MonographSchemaUpdate {
  eventName: OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED;
  payload: {
    monograph: {
      id: string;
      name: string;
      namespace: string;
    };
    organization: {
      id: string;
      slug: string;
    };
    actor_id?: string;
  };
}

export interface ProposalStateUpdated {
  eventName: OrganizationEventName.PROPOSAL_STATE_UPDATED;
  payload: {
    federated_graph: {
      id: string;
      name: string;
      namespace: string;
    };
    organization: {
      id: string;
      slug: string;
    };
    proposal: {
      id: string;
      name: string;
      namespace: string;
      state: string;
    };
    actor_id?: string;
  };
}

type OrganizationEventData = FederatedGraphSchemaUpdate | MonographSchemaUpdate | ProposalStateUpdated;

export interface SubgraphCheckExtensionResponse {
  errorMessage?: string;
  overwrite?: {
    lintIssues: LintIssueResult[];
  };
}

type Config = {
  url?: string;
  key?: string;
  allowedUserEvents?: string[];
  meta: PlainMessage<EventMeta>['meta'];
  type: 'webhook' | 'slack';
};

export class OrganizationWebhookService {
  private readonly logger: pino.Logger;
  private readonly defaultBillingPlanId?: string;
  private httpClient: AxiosInstance;

  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
    logger: pino.Logger,
    defaultBillingPlanId?: string,
  ) {
    this.logger = logger.child({ organizationId });
    this.defaultBillingPlanId = defaultBillingPlanId;

    this.httpClient = axios.create({
      timeout: 30_000,
    });
  }

  private async getOrganizationConfigs(eventName: OrganizationEventName) {
    const configs: Config[] = [];

    const orgRepo = new OrganizationRepository(this.logger, this.db, this.defaultBillingPlanId);
    const orgConfigs = await this.db.query.organizationWebhooks.findMany({
      where: eq(schema.organizationWebhooks.organizationId, this.organizationId),
      with: {
        webhookGraphSchemaUpdate: {
          with: {
            federatedGraph: {
              columns: {
                id: true,
              },
              with: {
                target: {
                  columns: {
                    type: true,
                  },
                },
              },
            },
          },
        },
        webhookProposalStateUpdate: {
          with: {
            federatedGraph: {
              columns: { id: true },
              with: {
                target: {
                  columns: {
                    type: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const config of orgConfigs) {
      let meta: PlainMessage<EventMeta>['meta'];

      switch (eventName) {
        case OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED: {
          meta = {
            case: 'federatedGraphSchemaUpdated',
            value: {
              graphIds: config.webhookGraphSchemaUpdate.map((wu) => wu.federatedGraphId),
            },
          };
          break;
        }
        case OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED: {
          meta = {
            case: 'monographSchemaUpdated',
            value: {
              graphIds: config.webhookGraphSchemaUpdate.map((wu) => wu.federatedGraphId),
            },
          };
          break;
        }
        case OrganizationEventName.PROPOSAL_STATE_UPDATED: {
          meta = {
            case: 'proposalStateUpdated',
            value: {
              graphIds: config.webhookProposalStateUpdate.map((wu) => wu.federatedGraphId),
            },
          };
          break;
        }
        default: {
          throw new Error(`Unhandled case encountered for ${eventName}`);
        }
      }

      configs.push({
        url: config?.endpoint ?? '',
        key: config?.key ?? '',
        allowedUserEvents: config?.events ?? [],
        type: 'webhook',
        meta,
      });
    }

    const integrations = await orgRepo.getIntegrations(this.organizationId);
    for (const integration of integrations) {
      if (integration.type !== 'slack') {
        continue;
      }

      const meta = integration.eventsMeta.find((em) => em.eventName === eventName)?.meta;
      if (!meta) {
        continue;
      }

      configs.push({
        url: integration.integrationConfig?.config.value?.endpoint ?? '',
        key: '',
        allowedUserEvents: integration.events ?? [],
        type: 'slack',
        meta,
      });
    }

    return configs;
  }

  private shouldProcess(eventData: OrganizationEventData, config: Config) {
    if (
      !config.url ||
      !config.allowedUserEvents?.includes(OrganizationEventName[eventData.eventName]) ||
      !config.meta
    ) {
      return false;
    }

    switch (eventData.eventName) {
      case OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED: {
        if (config.meta.case !== 'federatedGraphSchemaUpdated' || config.meta.value.graphIds?.length === 0) {
          return false;
        }

        return config.meta.value.graphIds?.includes(eventData.payload.federated_graph.id);
      }
      case OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED: {
        if (config.meta.case !== 'monographSchemaUpdated' || config.meta.value.graphIds?.length === 0) {
          return false;
        }

        return config.meta.value.graphIds?.includes(eventData.payload.monograph.id);
      }
      case OrganizationEventName.PROPOSAL_STATE_UPDATED: {
        if (
          config.meta.case !== 'proposalStateUpdated' ||
          config.meta.value.graphIds?.length === 0 ||
          config.type === 'slack'
        ) {
          return false;
        }

        return config.meta.value.graphIds?.includes(eventData.payload.federated_graph.id);
      }
      default: {
        return true;
      }
    }
  }

  private async constructSlackBody(eventData: OrganizationEventData): Promise<{ blocks: any[]; attachments: any[] }> {
    switch (eventData.eventName) {
      case OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED:
      case OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED: {
        let graph: {
          id: string;
          name: string;
          namespace: string;
        };

        switch (eventData.eventName) {
          case OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED: {
            graph = eventData.payload.federated_graph;
            break;
          }
          case OrganizationEventName.MONOGRAPH_SCHEMA_UPDATED: {
            graph = eventData.payload.monograph;
            break;
          }
        }

        const fedRepo = new FederatedGraphRepository(this.logger, this.db, eventData.payload.organization.id);
        const latestChangelogs = await fedRepo.fetchLatestFederatedGraphChangelog(graph.id);

        let linkToChangelog = `${process.env.WEB_BASE_URL}/${eventData.payload.organization.slug}/${graph.namespace}/graph/${graph.name}`;
        if (latestChangelogs) {
          linkToChangelog += `/changelog/${latestChangelogs?.schemaVersionId}`;
        }

        const tempData: { blocks: any[]; attachments: any[] } = {
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🚀 Schema of the federated graph *<${process.env.WEB_BASE_URL}/${eventData.payload.organization.slug}/${graph.namespace}/graph/${graph.name} | ${graph.name}>* has been updated 🎉`,
              },
            },
          ],
          attachments: [
            {
              color: '#fafafa',
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `Click <${linkToChangelog}| here> for more details.`,
                  },
                },
              ],
            },
          ],
        };
        if (latestChangelogs) {
          const addedChanges = latestChangelogs.changelogs.filter((c) => c.changeType.includes('ADDED'));
          const removedChanges = latestChangelogs.changelogs.filter((c) => c.changeType.includes('REMOVED'));
          const changedChanges = latestChangelogs.changelogs.filter((c) => c.changeType.includes('CHANGED'));

          if (removedChanges.length + addedChanges.length + changedChanges.length > 20) {
            tempData.attachments.unshift({
              color: '#e11d48',
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `Too many changes to display. There were ${removedChanges.length + changedChanges.length} deletions and ${addedChanges.length + changedChanges.length} additions.`,
                  },
                },
              ],
            });
            return tempData;
          }

          if (changedChanges.length > 0) {
            tempData.attachments.unshift({
              color: '#8D879D',
              blocks: [
                {
                  type: 'rich_text',
                  elements: [
                    {
                      type: 'rich_text_list',
                      style: 'bullet',
                      elements: changedChanges.map((r) => ({
                        type: 'rich_text_section',
                        elements: [
                          {
                            type: 'text',
                            text: r.changeMessage,
                          },
                        ],
                      })),
                    },
                  ],
                },
              ],
            });
          }

          if (removedChanges.length > 0) {
            tempData.attachments.unshift({
              color: '#e11d48',
              blocks: [
                {
                  type: 'rich_text',
                  elements: [
                    {
                      type: 'rich_text_list',
                      style: 'bullet',
                      elements: removedChanges.map((r) => ({
                        type: 'rich_text_section',
                        elements: [
                          {
                            type: 'text',
                            text: r.changeMessage,
                          },
                        ],
                      })),
                    },
                  ],
                },
              ],
            });
          }

          if (addedChanges.length > 0) {
            tempData.attachments.unshift({
              color: '#22c55e',
              blocks: [
                {
                  type: 'rich_text',
                  elements: [
                    {
                      type: 'rich_text_list',
                      style: 'bullet',
                      elements: addedChanges.map((r) => ({
                        type: 'rich_text_section',
                        elements: [
                          {
                            type: 'text',
                            text: r.changeMessage,
                          },
                        ],
                      })),
                    },
                  ],
                },
              ],
            });
          }
        }
        return tempData;
      }
      default: {
        return { blocks: [], attachments: [] };
      }
    }
  }

  private async sendEvent(eventData: OrganizationEventData, configs: Config[], actorId: string) {
    const eventName = OrganizationEventName[eventData.eventName];
    const logger = this.logger.child({ eventName });

    for (const config of configs) {
      if (!this.shouldProcess(eventData, config)) {
        continue;
      }

      if (!config.url) {
        continue;
      }

      let data = {};
      if (config.type === 'slack') {
        data = await this.constructSlackBody(eventData);
      } else {
        data = {
          version: 1,
          event: eventName,
          payload: eventData.payload,
        };
      }

      await this.#sendWebhookRequest(
        config.url,
        config.key,
        data,
        {
          organizationId: this.organizationId,
          type: config.type,
          endpoint: config.url,
          eventName,
          payload: JSON.stringify(data),
          createdById: actorId,
          requestHeaders: {},
        },
        logger,
      );
    }
  }

  async #sendWebhookRequest<TResponse = any>(
    endpoint: string,
    secretKey: string | undefined,
    data: unknown,
    deliveryInfo: WebhookDeliveryInfo,
    logger: pino.Logger,
  ): Promise<AxiosResponse<TResponse> | undefined> {
    let retryCount = 0;
    const startTime = performance.now();

    axiosRetry(this.httpClient, {
      retries: 6,
      retryDelay: (retryCount, error) => {
        return exponentialDelay(retryCount, error, 1000);
      },
      shouldResetTimeout: true,
      retryCondition: webhookAxiosRetryCond,
      onRetry: (count) => {
        retryCount = count;
      },
    });

    this.httpClient.interceptors.request.use((request) => {
      deliveryInfo.requestHeaders = request.headers;
      return request;
    });

    // @TODO Use a queue to send the events
    let res: AxiosResponse | undefined;
    try {
      res = await makeWebhookRequest<any, TResponse>(this.httpClient, data, endpoint, secretKey);
      deliveryInfo.responseStatusCode = res.status;
      deliveryInfo.responseHeaders = res.headers;
      deliveryInfo.responseBody = JSON.stringify(res.data);
    } catch (error: any) {
      if (error instanceof AxiosError) {
        logger.debug(
          { statusCode: error.response?.status, message: error.message },
          'Could not send organization webhook event',
        );
        deliveryInfo.responseHeaders = error.response?.headers;
        deliveryInfo.responseStatusCode = error.response?.status;
        deliveryInfo.responseErrorCode = error.code;
        deliveryInfo.responseBody = JSON.stringify(error.response?.data);
        deliveryInfo.errorMessage = error.message;

        if (error.response?.data &&
          typeof error.response?.data === 'object' &&
          'errorMessage' in error.response.data &&
          typeof error.response.data.errorMessage === 'string') {
          // Overwrite the error message with the response error message
          deliveryInfo.errorMessage = error.response.data.errorMessage;
        }
      } else {
        logger.debug(error, 'Could not send organization webhook event');
        deliveryInfo.errorMessage = error.message || 'Failed due to unknown reasons';
      }
    }

    deliveryInfo.duration = performance.now() - startTime;
    deliveryInfo.retryCount = retryCount;

    const insertedDeliveryInfo = await this.db
      .insert(schema.webhookDeliveries)
      .values(deliveryInfo)
      .returning()
      .execute();
    deliveryInfo.id = insertedDeliveryInfo[0].id;

    return res;
  }

  async send(eventData: OrganizationEventData, actorId: string) {
    try {
      const configs = await this.getOrganizationConfigs(eventData.eventName);
      await this.sendEvent(eventData, configs, actorId);
    } catch (e: any) {
      const logger = this.logger.child({ eventName: OrganizationEventName[eventData.eventName] });
      logger.child({ message: e.message });
      logger.error(`Could not send webhook event`);
    }
  }

  async sendSubgraphCheckExtension(input: {
    actorId: string;
    schemaCheckID: string;
    labels?: Label[];
    blobStorage: BlobStorage;
    admissionConfig: { jwtSecret: string; cdnBaseUrl: string };
    organization: { id: string; slug: string };
    namespace: NamespaceDTO;
    vcsContext: VCSContext | undefined;
    subgraph: SubgraphDTO | undefined;
    newSchemaSDL: string;
    isDeleted: boolean;
    affectedGraphs: FederatedGraphDTO[];
    composedGraphs: ComposedFederatedGraph[];
    schemaChanges: GetDiffBetweenGraphsSuccess;
    lintIssues: SchemaLintIssues;
    pruneIssues: SchemaGraphPruningIssues;
    inspectedOperations: InspectorOperationResult[];
  }): Promise<
    | {
        deliveryInfo: WebhookDeliveryInfo;
        overwriteLintIssues: boolean;
        lintIssues: SchemaLintIssues;
      }
    | undefined
  > {
    if (!input.namespace.enableSubgraphCheckExtensions) {
      // The subgraph check extensions are not enabled for the namespace, we don't need to execute the webhook
      return undefined;
    }

    // Even when the subgraph check extensions are enabled for the namespace, make sure that the organization have
    // access to this feature
    const orgRepo = new OrganizationRepository(this.logger, this.db);
    const sceFeature = await orgRepo.getFeature({
      organizationId: this.organizationId,
      featureId: 'subgraph-check-extensions',
    });

    if (!sceFeature?.enabled) {
      // The organization doesn't have access to this feature, we don't need to execute the webhook
      return undefined;
    }

    // Retrieve the subgraph check extension configuration
    const sceRepo = new SubgraphCheckExtensionsRepository(this.db);
    const sceConfig = await sceRepo.getNamespaceConfig(input.namespace.id);
    if (!sceConfig.endpoint) {
      // The endpoint is not configured
      return undefined;
    }

    // Compose the contents of the file that we'll provide to the webhook
    const fileContent: Record<string, unknown> = {};
    if (sceConfig.includeComposedSdl) {
      fileContent.subgraph = {
        id: input.subgraph?.id,
        name: input.subgraph?.name,
        newComposedSdl: input.newSchemaSDL,
        oldComposedSdl: input.subgraph?.schemaSDL,
      };

      fileContent.composition = input.composedGraphs.map((c) => ({
        id: c.id,
        name: c.name,
        composedSchema: c.composedSchema,
        federatedClientSchema: c.federatedClientSchema,
        subgraphs: c.subgraphs.map((sg) => ({ id: sg.id, name: sg.name })),
      }));
    }

    if (sceConfig.includeLintingIssues) {
      fileContent.lintIssues = input.lintIssues;
    }

    if (sceConfig.includePruningIssues) {
      fileContent.pruningIssues = input.pruneIssues;
    }

    if (sceConfig.includeSchemaChanges) {
      fileContent.schemaChanges = input.schemaChanges.changes;
    }

    if (sceConfig.includeAffectedOperations) {
      fileContent.affectedOperations = input.inspectedOperations;
    }

    // Upload the generated file content
    const blobKey = `/${input.organization.id}/subgraph_checks/${v4()}.json`;
    const blobContent = JSON.stringify(fileContent);
    await input.blobStorage.putObject({
      key: blobKey,
      contentType: 'application/json',
      body: Buffer.from(blobContent, 'utf8'),
    });

    const token = await signJwtHS256({
      secret: input.admissionConfig.jwtSecret,
      token: {
        exp: nowInSeconds() + 15 * 60, // 15 minutes,
        aud: audiences.cosmoCDNAdmission,
        organization_id: input.organization.id,
      },
    });

    // Compose the webhook payload
    const payload: Record<string, unknown> = {
      actorId: input.actorId,
      checkId: input.schemaCheckID,
      labels: input.subgraph ? undefined : input.labels,
      organization: input.organization,
      namespace: { id: input.namespace.id, name: input.namespace.name },
      vcsContext: input.vcsContext,
      affectedGraphs: input.affectedGraphs.map((graph) => ({
        id: graph.id,
        name: graph.name,
      })),
      url: `${input.admissionConfig.cdnBaseUrl}${blobKey}?token=${token}`,
    };

    if (input.subgraph) {
      payload.subgraph = {
        id: input.subgraph.id,
        name: input.subgraph.name,
        isDeleted: input.isDeleted,
      };
    }

    // Deliver the webhook
    const deliveryInfo: WebhookDeliveryInfo = {
      organizationId: this.organizationId,
      type: 'check-extension',
      endpoint: sceConfig.endpoint,
      eventName: 'SUBGRAPH_CHECK_EXTENSION',
      payload: JSON.stringify(payload),
      createdById: input.actorId,
      requestHeaders: {},
    };

    const response = await this.#sendWebhookRequest<SubgraphCheckExtensionResponse>(
      sceConfig.endpoint,
      sceConfig.secretKey,
      payload,
      deliveryInfo,
      this.logger,
    );

    if (
      response &&
      ((response.status !== 200 && response.status !== 204) ||
        (response.data && typeof response.data.errorMessage === 'string'))
    ) {
      //
      deliveryInfo.errorMessage =
        response.data?.errorMessage ??
        `Check extension returned status code '${response?.status}'. Allowed values are 200 and 204.`;

      await this.db
        .update(schema.webhookDeliveries)
        .set({ errorMessage: response.data.errorMessage })
        .where(eq(schema.webhookDeliveries.id, deliveryInfo.id!))
        .execute();
    }

    const overwriteLintIssues = Array.isArray(response?.data?.overwrite?.lintIssues);
    return {
      deliveryInfo,
      overwriteLintIssues,
      lintIssues: overwriteLintIssues
        ? {
            warnings: response.data.overwrite!.lintIssues!.filter((issue) => issue.severity === LintSeverity.warn),
            errors: response.data.overwrite!.lintIssues!.filter((issue) => issue.severity === LintSeverity.error),
          }
        : input.lintIssues,
    };
  }
}
