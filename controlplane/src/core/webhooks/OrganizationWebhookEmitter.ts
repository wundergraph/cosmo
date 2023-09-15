import axios from 'axios';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { backOff } from 'exponential-backoff';
import {
  GraphSchemaUpdate,
  OrganizationEventName,
} from '@wundergraph/cosmo-connect/dist/webhooks/organization_webhooks_pb';
import { PlainMessage } from '@bufbuild/protobuf';
import * as schema from '../../db/schema.js';

interface EventMap {
  [OrganizationEventName.GRAPH_SCHEMA_UPDATED]: PlainMessage<GraphSchemaUpdate>;
}

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

  private sendEvent<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.url) {
      return;
    }

    if (!this.allowedUserEvents?.includes(OrganizationEventName[eventName])) {
      return;
    }

    backOff(
      () =>
        axios.post(
          this.url!,
          {
            event: OrganizationEventName[eventName],
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

  send<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.synced) {
      this.syncOrganizationSettings().then(() => this.sendEvent(eventName, data));
      return;
    }

    this.sendEvent(eventName, data);
  }
}
