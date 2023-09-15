import { PlainMessage } from '@bufbuild/protobuf';
import {
  GraphMigrate,
  PlatformEventName,
  UserRegister,
} from '@wundergraph/cosmo-connect/dist/webhooks/platform_webhooks_pb';
import axios from 'axios';
import { backOff } from 'exponential-backoff';

interface EventMap {
  [PlatformEventName.USER_REGISTER_SUCCESS]: PlainMessage<UserRegister>;
  [PlatformEventName.GRAPH_MIGRATE_INIT]: PlainMessage<GraphMigrate>;
  [PlatformEventName.GRAPH_MIGRATE_SUCCESS]: PlainMessage<GraphMigrate>;
}

export type EventType<T extends keyof EventMap> = {
  name: T;
  data: EventMap[T];
};

export class PlatformWebhookEmitter {
  private url: string;
  private key: string;

  constructor(webhookURL = '', webhookKey = '') {
    this.url = webhookURL;
    this.key = webhookKey;
  }

  send<T extends keyof EventMap>(eventName: T, data: EventMap[T]) {
    if (!this.url) {
      return;
    }

    backOff(
      () =>
        axios.post(
          this.url,
          {
            event: PlatformEventName[eventName],
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
