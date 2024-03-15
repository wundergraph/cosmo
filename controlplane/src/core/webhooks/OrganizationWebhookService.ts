import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import pino from 'pino';
import { PlainMessage } from '@bufbuild/protobuf';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
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
  type: string;
};

export class OrganizationWebhookService {
  private readonly configs?: Config[];
  private synced?: boolean;
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
    this.configs = [];
    this.synced = false;

    this.httpClient = axios.create({
      timeout: 10_000,
    });
    axiosRetry(this.httpClient, {
      retries: 5,
      retryDelay: (retryCount) => {
        return exponentialDelay(retryCount);
      },
      shouldResetTimeout: true,
    });
  }

  private async syncOrganizationSettings(eventName: OrganizationEventName) {
    const orgRepo = new OrganizationRepository(this.db, this.defaultBillingPlanId);
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
      }

      this.configs?.push({
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

      this.configs?.push({
        url: integration.integrationConfig?.config.value?.endpoint ?? '',
        key: '',
        allowedUserEvents: integration.events ?? [],
        type: 'slack',
        meta,
      });
    }

    this.synced = true;
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
          const addedChanges = latestChangelogs.changelogs.filter(
            (c) => c.changeType.includes('ADDED') || c.changeType.includes('CHANGED'),
          );
          const removedChanges = latestChangelogs.changelogs.filter((c) => c.changeType.includes('REMOVED'));

          if (removedChanges.length + addedChanges.length > 20) {
            tempData.attachments.unshift({
              color: '#e11d48',
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `Too many changes to display. There were ${removedChanges.length} deletions and ${addedChanges.length} additions.`,
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

  private async sendEvent(eventData: OrganizationEventData) {
    if (!this.configs) {
      return;
    }

    const logger = this.logger.child({ eventName: OrganizationEventName[eventData.eventName] });

    for (const config of this.configs) {
      if (!this.shouldProcess(eventData, config)) {
        continue;
      }

      if (!config.url) {
        logger.error('Webhook URL is not set');
        continue;
      }

      let data = {};
      if (config.type === 'slack') {
        data = await this.constructSlackBody(eventData);
      } else {
        data = {
          version: 1,
          event: OrganizationEventName[eventData.eventName],
          payload: eventData.payload,
        };
      }

      // @TODO Use a queue to send the events
      makeWebhookRequest(this.httpClient, data, config.url, config.key).catch((error: AxiosError) => {
        if (error instanceof AxiosError) {
          logger.debug(
            { statusCode: error.response?.status, message: error.message },
            'Could not send organization webhook event',
          );
        } else {
          logger.debug(error, 'Could not send organization webhook event');
        }
      });
    }
  }

  send(eventData: OrganizationEventData) {
    if (!this.synced) {
      this.syncOrganizationSettings(eventData.eventName)
        .then(() => this.sendEvent(eventData))
        .catch((e) => {
          const logger = this.logger.child({ eventName: OrganizationEventName[eventData.eventName] });
          logger.child({ message: e.message });
          logger.error(`Could not send webhook event`);
        });
      return;
    }

    this.sendEvent(eventData);
  }
}
