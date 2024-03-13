import { PlainMessage } from '@bufbuild/protobuf';
import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import pino from 'pino';
import axios, { AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { makeWebhookRequest } from './utils.js';

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
  private httpClient: AxiosInstance;

  constructor(webhookURL = '', webhookKey = '', logger: pino.Logger) {
    this.url = webhookURL;
    this.key = webhookKey;
    this.logger = logger;

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

  send<T extends keyof EventMap>(eventName: T, eventData: EventMap[T]) {
    if (!this.url) {
      return;
    }

    const logger = this.logger.child({ eventName: PlatformEventName[eventName] });

    const data = {
      version: 1,
      event: PlatformEventName[eventName],
      payload: eventData,
    };

    // Don't wait for the response
    makeWebhookRequest(this.httpClient, data, logger, this.url, this.key);
  }
}

export class MockPlatformWebhookService implements IPlatformWebhookService {
  public sentEvents: Array<{ eventName: keyof EventMap; eventPayload: PlainMessage<any> }> = [];

  send<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T]) {
    this.sentEvents.push({ eventName, eventPayload });
  }
}
