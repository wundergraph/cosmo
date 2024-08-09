import { createHmac } from 'node:crypto';
import { AxiosError, AxiosInstance } from 'axios';
import pino from 'pino';

export const makeWebhookRequest = <Data = any>(
  axiosInstance: AxiosInstance,
  data: Data,
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

  return axiosInstance.post(url, data, {
    headers,
  });
};

export const toISODateTime = (secs: number) => {
  const t = new Date('1970-01-01T00:30:00Z'); // Unix epoch start.
  t.setSeconds(secs);
  return t;
};
