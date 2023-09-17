import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/webhooks/events_pb';
import pino from 'pino';
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

export class OrganizationWebhookService {
  private configs?: {
    url?: string;
    key?: string;
    allowedUserEvents?: string[];
  }[];

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
    });

    orgConfigs.map((config) =>
      this.configs?.push({
        url: config?.endpoint ?? '',
        key: config?.key ?? '',
        allowedUserEvents: config?.events ?? [],
      }),
    );

    this.synced = true;
  }

  private sendEvent<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T]) {
    if (!this.configs) {
      return;
    }

    for (const config of this.configs) {
      if (!config.url) {
        continue;
      }

      if (!config.allowedUserEvents?.includes(OrganizationEventName[eventName])) {
        continue;
      }

      const data = {
        version: 1,
        event: OrganizationEventName[eventName],
        payload: eventPayload,
      };

      post(OrganizationEventName[eventName], data, this.logger, config.url, config.key);
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
