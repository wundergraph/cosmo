import { PlainMessage } from '@bufbuild/protobuf';
import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import pino from 'pino';
import { post } from './utils.js';

interface UserRegister {
  user_id: string;
  user_email: string;
}

interface ApolloMigrate {
  federated_graph?: {
    id: string;
    name: string;
  };
  actor_id?: string;
}

interface EventMap {
  [PlatformEventName.USER_REGISTER_SUCCESS]: UserRegister;
  [PlatformEventName.APOLLO_MIGRATE_INIT]: ApolloMigrate;
  [PlatformEventName.APOLLO_MIGRATE_SUCCESS]: ApolloMigrate;
}

export type EventType<T extends keyof EventMap> = {
  name: T;
  data: EventMap[T];
};

export interface IPlatformWebhookService {
  send<T extends keyof EventMap>(eventName: T, eventData: EventMap[T]): void;
}

export class PlatformWebhookService implements IPlatformWebhookService {
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
      version: 1,
      event: PlatformEventName[eventName],
      payload: eventData,
    };

    post(PlatformEventName[eventName], data, this.logger, 'error', this.url, this.key);
  }
}

export class MockPlatformWebhookService implements IPlatformWebhookService {
  public sentEvents: Array<{ eventName: keyof EventMap; eventPayload: PlainMessage<any> }> = [];

  send<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T]) {
    this.sentEvents.push({ eventName, eventPayload });
  }
}
