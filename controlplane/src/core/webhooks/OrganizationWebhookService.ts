import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import pino from 'pino';
import { PartialMessage } from '@bufbuild/protobuf';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import axios, { AxiosInstance } from 'axios';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { FederatedGraphRepository } from '../repositories/FederatedGraphRepository.js';
import { makeWebhookRequest } from './utils.js';

export interface FederatedGraphSchemaUpdate {
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
}

interface EventMap {
  [OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED]: FederatedGraphSchemaUpdate;
}

type Config = {
  url?: string;
  key?: string;
  allowedUserEvents?: string[];
  meta: PartialMessage<EventMeta>[];
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

  private async syncOrganizationSettings() {
    const orgRepo = new OrganizationRepository(this.db, this.defaultBillingPlanId);
    const orgConfigs = await this.db.query.organizationWebhooks.findMany({
      where: eq(schema.organizationWebhooks.organizationId, this.organizationId),
      with: {
        webhookGraphSchemaUpdate: true,
      },
    });

    for (const config of orgConfigs) {
      const meta: PartialMessage<EventMeta>[] = [];

      meta.push({
        eventName: OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        meta: {
          case: 'federatedGraphSchemaUpdated',
          value: {
            graphIds: config.webhookGraphSchemaUpdate.map((wu) => wu.federatedGraphId),
          },
        },
      });

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

      this.configs?.push({
        url: integration.integrationConfig?.config.value?.endpoint ?? '',
        key: '',
        allowedUserEvents: integration.events ?? [],
        type: 'slack',
        meta: integration.eventsMeta,
      });
    }

    this.synced = true;
  }

  private shouldProcess<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T], config: Config) {
    if (!config.url) {
      return false;
    }

    if (!config.allowedUserEvents?.includes(OrganizationEventName[eventName])) {
      return false;
    }

    if (!config.meta) {
      return true;
    }

    switch (eventName) {
      case OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED: {
        const meta = config.meta.find(
          (m) => m.eventName === OrganizationEventName.FEDERATED_GRAPH_SCHEMA_UPDATED,
        )?.meta;

        if (!meta || meta?.case !== 'federatedGraphSchemaUpdated' || meta.value.graphIds?.length === 0) {
          return true;
        }

        return meta.value.graphIds?.includes(eventPayload.federated_graph.id);
      }
      default: {
        return true;
      }
    }
  }

  private async constructSlackBody<T extends keyof EventMap>(eventPayload: EventMap[T]) {
    const fedRepo = new FederatedGraphRepository(this.logger, this.db, eventPayload.organization.id);
    const latestChangelogs = await fedRepo.fetchLatestFederatedGraphChangelog(eventPayload.federated_graph.id);

    let linkToChangelog = `https://cosmo.wundergraph.com/${eventPayload.organization.slug}/${eventPayload.federated_graph.namespace}/graph/${eventPayload.federated_graph.name}`;
    if (latestChangelogs) {
      linkToChangelog += `/changelog/${latestChangelogs?.schemaVersionId}`;
    }

    const tempData: { blocks: any[]; attachments: any[] } = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚀 Schema of the federated graph *<https://cosmo.wundergraph.com/${eventPayload.organization.slug}/${eventPayload.federated_graph.namespace}/graph/${eventPayload.federated_graph.name} | ${eventPayload.federated_graph.name}>* has been updated 🎉`,
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

  private async sendEvent<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T]) {
    if (!this.configs) {
      return;
    }

    const logger = this.logger.child({ eventName: OrganizationEventName[eventName] });

    for (const config of this.configs) {
      if (!this.shouldProcess(eventName, eventPayload, config)) {
        continue;
      }

      if (!config.url) {
        logger.error('Webhook URL is not set');
        continue;
      }

      let data = {};
      if (config.type === 'slack') {
        data = await this.constructSlackBody(eventPayload);
      } else {
        data = {
          version: 1,
          event: OrganizationEventName[eventName],
          payload: eventPayload,
        };
      }

      // Don't wait for the response.
      // @TODO Use a queue to send the events
      makeWebhookRequest(this.httpClient, data, logger, config.url, config.key);
    }
  }

  send<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.synced) {
      this.syncOrganizationSettings()
        .then(() => this.sendEvent(eventName, data))
        .catch((e) => {
          const logger = this.logger.child({ eventName: OrganizationEventName[eventName] });
          logger.child({ message: e.message });
          logger.error(`Could not send webhook event`);
        });
      return;
    }

    this.sendEvent(eventName, data);
  }
}
