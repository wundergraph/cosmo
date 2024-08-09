import { PlainMessage } from '@bufbuild/protobuf';
import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import pino from 'pino';
import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { makeWebhookRequest } from './utils.js';

interface User {
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
  [PlatformEventName.USER_REGISTER_SUCCESS]: User;
  [PlatformEventName.APOLLO_MIGRATE_INIT]: ApolloMigrate;
  [PlatformEventName.APOLLO_MIGRATE_SUCCESS]: ApolloMigrate;
  [PlatformEventName.USER_DELETE_SUCCESS]: User;
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
      retries: 6,
      retryDelay: (retryCount, error) => {
        return exponentialDelay(retryCount, error, 1000);
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

    // @TODO Use a queue to send the events
    makeWebhookRequest(this.httpClient, data, this.url, this.key).catch((error: AxiosError) => {
      if (error instanceof AxiosError) {
        logger.error(
          { statusCode: error.response?.status, message: error.message },
          'Could not send platform webhook event',
        );
      } else {
        logger.error(error, 'Could not send platform webhook event');
      }
    });
  }
}

export class MockPlatformWebhookService implements IPlatformWebhookService {
  public sentEvents: Array<{ eventName: keyof EventMap; eventPayload: PlainMessage<any> }> = [];

  send<T extends keyof EventMap>(eventName: T, eventPayload: EventMap[T]) {
    this.sentEvents.push({ eventName, eventPayload });
  }
}
