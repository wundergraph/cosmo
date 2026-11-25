import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { WebhookDeliveryInfo } from '../../db/models.js';
import * as schema from '../../db/schema.js';
import { webhookAxiosRetryCond } from '../util.js';
import { traced } from '../tracing.js';
import { makeWebhookRequest } from './utils.js';

@traced
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
        requestHeaders: {},
        originalDeliveryId: originalDelivery.id,
      };

      axiosRetry(this.httpClient, {
        retries: 6,
        retryCondition: webhookAxiosRetryCond,
        retryDelay: (retryCount, error) => {
          return exponentialDelay(retryCount, error, 1000);
        },
        shouldResetTimeout: true,
        onRetry: (count) => {
          retryCount = count;
        },
      });

      this.httpClient.interceptors.request.use((request) => {
        deliveryInfo.requestHeaders = request.headers;
        return request;
      });

      try {
        const res = await this.post(originalDelivery);

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

  // Organization webhooks are signed again with the webhook's current secret and keep their delivery id, like a first delivery.
  private async post(originalDelivery: typeof schema.webhookDeliveries.$inferSelect) {
    const data = JSON.parse(originalDelivery.payload);

    if (originalDelivery.type !== 'webhook') {
      return this.httpClient.post(originalDelivery.endpoint, data, { headers: originalDelivery.requestHeaders });
    }

    const [config] = await this.db
      .select({ key: schema.organizationWebhooks.key })
      .from(schema.organizationWebhooks)
      .where(
        and(
          eq(schema.organizationWebhooks.organizationId, this.organizationId),
          eq(schema.organizationWebhooks.endpoint, originalDelivery.endpoint),
        ),
      )
      .limit(1);

    const deliveryId = originalDelivery.requestHeaders['X-Cosmo-Delivery-Id'];

    return makeWebhookRequest(
      this.httpClient,
      data,
      originalDelivery.endpoint,
      config?.key ?? undefined,
      typeof deliveryId === 'string' ? deliveryId : undefined,
    );
  }
}
