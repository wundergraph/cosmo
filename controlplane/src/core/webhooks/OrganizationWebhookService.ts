import { PlainMessage } from '@bufbuild/protobuf';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { WebhookDeliveryInfo } from '../../db/models.js';
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

type OrganizationEventData = FederatedGraphSchemaUpdate | MonographSchemaUpdate;

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
      const startTime = performance.now();
      let retryCount = 0;

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

      const deliveryInfo: WebhookDeliveryInfo = {
        organizationId: this.organizationId,
        type: config.type,
        endpoint: config.url,
        eventName,
        payload: JSON.stringify(data),
        createdById: actorId,
        requestHeaders: {},
      };

      axiosRetry(this.httpClient, {
        retries: 6,
        retryDelay: (retryCount, error) => {
          return exponentialDelay(retryCount, error, 1000);
        },
        shouldResetTimeout: true,
        onRetry: (count) => {
          retryCount = count;
        },
      });

      this.httpClient.interceptors.request.use((request) => {
        deliveryInfo.requestHeaders = request.headers;
        return request;
      });

      // @TODO Use a queue to send the events
      try {
        const res = await makeWebhookRequest(this.httpClient, data, config.url, config.key);
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
        } else {
          logger.debug(error, 'Could not send organization webhook event');
          deliveryInfo.errorMessage = error.message || 'Failed due to unknown reasons';
        }
      }

      const endTime = performance.now();
      deliveryInfo.duration = endTime - startTime;
      deliveryInfo.retryCount = retryCount;

      await this.db.insert(schema.webhookDeliveries).values(deliveryInfo);
    }
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
}
