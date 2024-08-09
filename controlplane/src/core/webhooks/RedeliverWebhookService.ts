import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { WebhookDeliveryInfo } from '../../db/models.js';
import * as schema from '../../db/schema.js';

export class RedeliverWebhookService {
  private readonly logger: FastifyBaseLogger;
  private httpClient: AxiosInstance;

  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
    logger: FastifyBaseLogger,
  ) {
    this.logger = logger.child({ organizationId });

    this.httpClient = axios.create({
      timeout: 30_000,
    });
  }

  async send(originalDelivery: typeof schema.webhookDeliveries.$inferSelect, actorId: string) {
    const logger = this.logger.child({ originalDeliveryId: originalDelivery.id });
    try {
      const startTime = performance.now();
      let retryCount = 0;

      const deliveryInfo: WebhookDeliveryInfo = {
        organizationId: this.organizationId,
        type: originalDelivery.type,
        endpoint: originalDelivery.endpoint,
        eventName: originalDelivery.eventName,
        payload: originalDelivery.payload,
        createdById: actorId,
        requestHeaders: originalDelivery.requestHeaders,
        originalDeliveryId: originalDelivery.id,
      };

      axiosRetry(this.httpClient, {
        retries: 6,
        retryDelay: (retryCount, error) => {
          return exponentialDelay(retryCount, error, 1000);
        },
        shouldResetTimeout: true,
        onRetry: (count) => {
          retryCount = count;
        },
      });

      try {
        const res = await this.httpClient.post(originalDelivery.endpoint, JSON.parse(originalDelivery.payload), {
          headers: originalDelivery.requestHeaders,
        });

        deliveryInfo.responseStatusCode = res.status;
        deliveryInfo.responseHeaders = res.headers;
        deliveryInfo.responseBody = JSON.stringify(res.data);
      } catch (error: any) {
        if (error instanceof AxiosError) {
          logger.debug(
            { statusCode: error.response?.status, message: error.message },
            'Could not send organization webhook event',
          );
          deliveryInfo.responseHeaders = error.response?.headers;
          deliveryInfo.responseStatusCode = error.response?.status;
          deliveryInfo.responseErrorCode = error.code;
          deliveryInfo.responseBody = JSON.stringify(error.response?.data);
          deliveryInfo.errorMessage = error.message;
        } else {
          logger.debug(error, 'Could not send organization webhook event');
          deliveryInfo.errorMessage = error.message || 'Failed due to unknown reasons';
        }
      }

      const endTime = performance.now();
      deliveryInfo.duration = endTime - startTime;
      deliveryInfo.retryCount = retryCount;

      await this.db.insert(schema.webhookDeliveries).values(deliveryInfo).returning();
    } catch (e: any) {
      logger.child({ message: e.message });
      logger.error(`Could not send webhook event`);
    }
  }
}
