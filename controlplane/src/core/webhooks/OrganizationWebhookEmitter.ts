import { createHmac } from 'node:crypto';
import axios from 'axios';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { backOff } from 'exponential-backoff';
import {
  GraphSchemaUpdate,
  OrganizationEventName,
} from '@wundergraph/cosmo-connect/dist/webhooks/organization_webhooks_pb';
import { PlainMessage } from '@bufbuild/protobuf';
import pino from 'pino';
import * as schema from '../../db/schema.js';

interface EventMap {
  [OrganizationEventName.GRAPH_SCHEMA_UPDATED]: PlainMessage<GraphSchemaUpdate>;
}

export class OrganizationWebhookEmitter {
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

  private sendEvent<T extends keyof EventMap>(eventName: T, eventData: EventMap[T]) {
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
        event: OrganizationEventName[eventName],
        payload: eventData,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (config.key) {
        const dataString = JSON.stringify(data);
        const signature = createHmac('sha256', config.key).update(dataString).digest('hex');
        headers['X-Cosmo-Signature-256'] = signature;
      }

      backOff(
        () =>
          axios.post(config.url!, data, {
            headers,
            timeout: 3000,
          }),
        {
          numOfAttempts: 5,
        },
      ).catch((e) => {
        let logger = this.logger.child({ eventName: OrganizationEventName[eventName] });
        logger = logger.child({ eventData });
        logger.debug(`Could not send organization webhook event`, e.message);
      });
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
