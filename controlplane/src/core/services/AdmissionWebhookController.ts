import axios, { AxiosError, AxiosInstance } from 'axios';
import { JWTPayload } from 'jose';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { FastifyBaseLogger } from 'fastify';

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
  signatureSHA256: string;
  error?: string;
}

export class AdmissionWebhookController {
  httpClient: AxiosInstance;
  constructor(
    private logger: FastifyBaseLogger,
    private graphAdmissionWebhookURL?: string,
  ) {
    this.httpClient = axios.create({
      timeout: 30_000,
      baseURL: this.graphAdmissionWebhookURL,
    });
    axiosRetry(this.httpClient, {
      retries: 5,
      retryDelay: (retryCount) => {
        return exponentialDelay(retryCount);
      },
      shouldResetTimeout: true,
    });
  }

  public async validateConfig(req: ValidateConfigRequest) {
    const url = this.graphAdmissionWebhookURL + '/validate-config';
    this.logger.debug({ url, path: '/validate-config', ...req }, 'Sending admission validate-config webhook request');

    try {
      const res = await this.httpClient.request<ValidateConfigResponse>({
        method: 'POST',
        url: '/validate-config',
        data: req,
      });

      this.logger.debug(
        {
          url: this.graphAdmissionWebhookURL + '/validate-config',
          statusCode: res.status,
          signature: res.data.signatureSHA256,
        },
        'Received admission validate-config webhook response.',
      );

      if (res.status !== 200) {
        throw new AdmissionError(
          `Non-200 status code '${res.status}' from admission /validate-config webhook handler received.`,
        );
      }

      if (!res.data.signatureSHA256) {
        throw new AdmissionError('No signature from admission /validate-config webhook handler received.');
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
        throw new AdmissionError(
          `Unable to reach admission webhook handler on ${url}. Make sure the URL is correct and the service is running.`,
        );
      }

      throw err;
    }
  }
}
