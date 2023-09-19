import { createHmac } from 'node:crypto';
import axios from 'axios';
import pino from 'pino';
import axiosRetry, { exponentialDelay } from 'axios-retry';

axiosRetry(axios, {
  retries: 5,
  retryDelay: (retryCount) => {
    return exponentialDelay(retryCount);
  },
  shouldResetTimeout: true,
});

export const post = (event: string, data: any, logger: pino.Logger, url: string, key?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (key) {
    const dataString = JSON.stringify(data);
    const signature = createHmac('sha256', key).update(dataString).digest('hex');
    headers['X-Cosmo-Signature-256'] = signature;
  }

  axios
    .post(url, data, {
      headers,
      timeout: 3000,
    })
    .catch((e) => {
      let log = logger.child({ eventName: event });
      log = log.child({ eventData: data });
      log.debug(`Could not send webhook event`, e.message);
    });
};
