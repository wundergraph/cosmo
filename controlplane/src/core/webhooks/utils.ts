import { createHmac } from 'node:crypto';
import { AxiosInstance } from 'axios';

export const makeWebhookRequest = <Data = any, TResponse = any>(
  axiosInstance: AxiosInstance,
  data: Data,
  url: string,
  signatureKey?: string,
  deliveryId?: string,
) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (deliveryId) {
    headers['X-Cosmo-Delivery-Id'] = deliveryId;
  }

  if (signatureKey) {
    const dataString = JSON.stringify(data);
    headers['X-Cosmo-Signature-256'] = createHmac('sha256', signatureKey).update(dataString).digest('hex');
  }

  return axiosInstance.post<TResponse>(url, data, {
    headers,
  });
};

export const toISODateTime = (secs: number) => {
  const t = new Date('1970-01-01T00:30:00Z'); // Unix epoch start.
  t.setSeconds(secs);
  return t;
};
