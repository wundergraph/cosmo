import { createHmac } from 'node:crypto';
import { PlainMessage } from '@bufbuild/protobuf';
import {
  GraphMigrate,
  PlatformEventName,
  UserRegister,
} from '@wundergraph/cosmo-connect/dist/webhooks/platform_webhooks_pb';
import axios from 'axios';
import { backOff } from 'exponential-backoff';
import pino from 'pino';

interface EventMap {
  [PlatformEventName.USER_REGISTER_SUCCESS]: PlainMessage<UserRegister>;
  [PlatformEventName.GRAPH_MIGRATE_INIT]: PlainMessage<GraphMigrate>;
  [PlatformEventName.GRAPH_MIGRATE_SUCCESS]: PlainMessage<GraphMigrate>;
}

export type EventType<T extends keyof EventMap> = {
  name: T;
  data: EventMap[T];
};

export interface IPlatformWebhookEmitter {
  send<T extends keyof EventMap>(eventName: T, eventData: EventMap[T]): void;
}

export class PlatformWebhookEmitter implements IPlatformWebhookEmitter {
  private url: string;
  private key: string;
  private logger: pino.Logger;

  constructor(webhookURL = '', webhookKey = '', logger: pino.Logger) {
    this.url = webhookURL;
    this.key = webhookKey;
    this.logger = logger;
  }

  send<T extends keyof EventMap>(eventName: T, eventData: EventMap[T]) {
    if (!this.url) {
      return;
    }

    const data = {
      event: PlatformEventName[eventName],
      payload: eventData,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.key) {
      const dataString = JSON.stringify(data);
      const signature = createHmac('sha256', this.key).update(dataString).digest('hex');
      headers['X-Cosmo-Signature-256'] = signature;
    }

    backOff(
      () =>
        axios.post(this.url, data, {
          headers,
          timeout: 3000,
        }),
      {
        numOfAttempts: 5,
      },
    ).catch((e) => {
      let logger = this.logger.child({ eventName: PlatformEventName[eventName] });
      logger = logger.child({ eventData });
      logger.debug(`Could not send platform webhook event`, e.message);
    });
  }
}

export class MockPlatformWebhookEmitter implements IPlatformWebhookEmitter {
  public sentEvents: Array<{ eventName: keyof EventMap; eventData: PlainMessage<any> }> = [];

  send<T extends keyof EventMap>(eventName: T, eventData: EventMap[T]) {
    this.sentEvents.push({ eventName, eventData });
  }
}
