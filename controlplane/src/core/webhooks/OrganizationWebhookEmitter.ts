import axios from 'axios';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { backOff } from 'exponential-backoff';
import * as schema from '../../db/schema.js';

interface GraphSchemaUpdate {
  id: string;
  name: string;
  errors: boolean;
  actorID?: string;
}

interface EventMap {
  'graph.schema.updated': GraphSchemaUpdate;
}

export type EventType<T extends keyof EventMap> = {
  name: T;
  data: EventMap[T];
};

export class OrganizationWebhookEmitter {
  private url?: string;
  private key?: string;
  private allowedUserEvents?: string[];
  private synced?: boolean;

  constructor(private db: PostgresJsDatabase<typeof schema>, private organizationId: string) {}

  private async syncOrganizationSettings() {
    const config = await this.db.query.organizationWebhooks.findFirst({
      where: eq(schema.organizationWebhooks.organizationId, this.organizationId),
    });

    this.url = config?.endpoint ?? '';
    this.key = config?.key ?? '';
    this.allowedUserEvents = config?.events ?? [];

    this.synced = true;
  }

  async send<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.synced) {
      await this.syncOrganizationSettings();
    }

    if (!this.url) {
      return;
    }

    if (!this.allowedUserEvents?.includes(eventName)) {
      return;
    }

    backOff(
      () =>
        axios.post(
          this.url!,
          {
            event: eventName,
            payload: data,
          },
          {
            headers: {
              'x-cosmo-webhook-key': this.key,
            },
          },
        ),
      {
        numOfAttempts: 5,
      },
    ).catch((e) => {});
  }
}
