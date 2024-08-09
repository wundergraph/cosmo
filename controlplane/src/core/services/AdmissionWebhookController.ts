import { createHmac } from 'node:crypto';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { JWTPayload } from 'jose';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { FastifyBaseLogger } from 'fastify';
import { OrganizationEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { WebhookDeliveryInfo } from '../../db/models.js';

export class AdmissionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    Object.setPrototypeOf(this, AdmissionError.prototype);
  }
}

export interface ValidateConfigRequest {
  privateConfigUrl: string;
  federatedGraphId: string;
  organizationId: string;
}

export interface AdmissionWebhookJwtPayload extends JWTPayload {
  organization_id: string;
  federated_graph_id: string;
}

export interface ValidateConfigResponse {
  signatureSha256: string;
  error?: string;
}

export class AdmissionWebhookController {
  httpClient: AxiosInstance;
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private logger: FastifyBaseLogger,
    private graphAdmissionWebhookURL?: string,
    private graphAdmissionWebhookSecret?: string,
  ) {
    this.httpClient = axios.create({
      timeout: 30_000,
      baseURL: this.graphAdmissionWebhookURL,
    });
  }

  public async validateConfig(req: ValidateConfigRequest, actorId: string) {
    const url = this.graphAdmissionWebhookURL + '/validate-config';
    const startTime = performance.now();
    let retryCount = 0;

    this.logger.debug({ url, path: '/validate-config', ...req }, 'Sending admission validate-config webhook request');

    const deliveryInfo: WebhookDeliveryInfo = {
      organizationId: req.organizationId,
      type: 'admission',
      endpoint: url,
      eventName: OrganizationEventName[OrganizationEventName.VALIDATE_CONFIG],
      payload: JSON.stringify(req),
      requestHeaders: {},
      createdById: actorId,
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

    this.httpClient.interceptors.request.use((request) => {
      deliveryInfo.requestHeaders = request.headers;
      return request;
    });

    try {
      const headers: Record<string, string> = {};
      if (this.graphAdmissionWebhookSecret) {
        const dataString = JSON.stringify(req);
        headers['X-Cosmo-Signature-256'] = createHmac('sha256', this.graphAdmissionWebhookSecret)
          .update(dataString)
          .digest('hex');
      }

      const res = await this.httpClient.request<ValidateConfigResponse>({
        method: 'POST',
        url: '/validate-config',
        data: req,
        headers,
      });

      deliveryInfo.responseStatusCode = res.status;
      deliveryInfo.responseHeaders = res.headers;
      deliveryInfo.responseBody = JSON.stringify(res.data);

      this.logger.debug(
        {
          url: this.graphAdmissionWebhookURL + '/validate-config',
          statusCode: res.status,
          signature: res.data.signatureSha256,
        },
        'Received admission validate-config webhook response.',
      );

      if (!res.data) {
        throw new AdmissionError('No response body from /validate-config handler received.');
      }

      if (!res.data.signatureSha256) {
        throw new AdmissionError('No signature from /validate-config handler received.');
      }

      return res.data;
    } catch (err: any) {
      this.logger.debug(
        {
          url: this.graphAdmissionWebhookURL,
          federatedGraphId: req.federatedGraphId,
          organizationId: req.organizationId,
          error: err,
        },
        'Failed to send admission to /validate-config webhook handler',
      );

      if (err instanceof AxiosError) {
        deliveryInfo.responseHeaders = err.response?.headers;
        deliveryInfo.responseStatusCode = err.response?.status;
        deliveryInfo.responseErrorCode = err.code;
        deliveryInfo.responseBody = JSON.stringify(err.response?.data);
        deliveryInfo.errorMessage = err.message;

        if (err.response?.status !== 200 && err.response?.data?.error) {
          throw new AdmissionError(
            `Config validation has failed. /validate-config handler responded with: StatusCode: ${err.response.status}. Error: ${err.response.data.error}`,
          );
        }
        throw new AdmissionError(
          `Unable to reach admission webhook handler on ${url}. Make sure the URL is correct and the service is running.`,
        );
      }

      deliveryInfo.errorMessage = err.message || 'Failed due to unknown reasons';
      throw err;
    } finally {
      const endTime = performance.now();
      deliveryInfo.duration = endTime - startTime;
      deliveryInfo.retryCount = retryCount;

      await this.db.insert(schema.webhookDeliveries).values(deliveryInfo);
    }
  }
}
