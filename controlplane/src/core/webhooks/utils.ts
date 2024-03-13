import { createHmac } from 'node:crypto';
import { AxiosError, AxiosInstance } from 'axios';
import pino from 'pino';

export const makeWebhookRequest = <Data = any>(
  axiosInstance: AxiosInstance,
  data: Data,
  logger: pino.Logger,
  url: string,
  signatureKey?: string,
) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (signatureKey) {
    const dataString = JSON.stringify(data);
    headers['X-Cosmo-Signature-256'] = createHmac('sha256', signatureKey).update(dataString).digest('hex');
  }

  axiosInstance
    .post(url, data, {
      headers,
      timeout: 10_000,
    })
    .catch((error: AxiosError) => {
      if (error instanceof AxiosError) {
        logger.debug({ statusCode: error.response?.status, message: error.message }, 'Could not send webhook event');
      } else {
        logger.debug(error, 'Could not send webhook event');
      }
    });
};

export const toISODateTime = (secs: number) => {
  const t = new Date('1970-01-01T00:30:00Z'); // Unix epoch start.
  t.setSeconds(secs);
  return t;
};
