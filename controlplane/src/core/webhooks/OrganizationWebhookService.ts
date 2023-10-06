import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { EventMeta, OrganizationEventName } from '@wundergraph/cosmo-connect/dist/webhooks/events_pb';
import pino from 'pino';
import { PartialMessage } from '@bufbuild/protobuf';
import * as schema from '../../db/schema.js';
import { post } from './utils.js';

interface FederatedGraphSchemaUpdate {
  federated_graph: {
    id: string;
    name: string;
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
};

export class OrganizationWebhookService {
  private configs?: Config[];

  private synced?: boolean;

  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
    private logger: pino.Logger,
  ) {
    this.configs = [];
    this.synced = false;
  }

  private async syncOrganizationSettings() {
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
        meta,
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

  private sendEvent<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T]) {
    if (!this.configs) {
      return;
    }

    for (const config of this.configs) {
      if (!this.shouldProcess(eventName, eventPayload, config)) {
        continue;
      }

      const data = {
        version: 1,
        event: OrganizationEventName[eventName],
        payload: eventPayload,
      };

      post(OrganizationEventName[eventName], data, this.logger, 'debug', config.url!, config.key);
    }
  }

  send<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.synced) {
      this.syncOrganizationSettings().then(() => this.sendEvent(eventName, data));
      return;
    }

    this.sendEvent(eventName, data);
  }
}
