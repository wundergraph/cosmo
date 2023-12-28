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

export const post = (
  event: string,
  data: any,
  logger: pino.Logger,
  logLevel: 'error' | 'debug',
  url: string,
  key?: string,
) => {
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
    .catch((error) => {
      let log = logger.child({ eventName: event });
      log = log.child({ eventData: data });

      if (error.response) {
        log = log.child({ statusCode: error.response.status });
      } else if (error.request) {
        log = log.child({ message: 'failed to send request' });
      } else {
        log = log.child({ message: error.message });
      }

      if (logLevel === 'error') {
        log.error('Could not send webhook event');
      } else {
        log.debug('Could not send webhook event');
      }
    });
};

export const toISODateTime = (secs: number) => {
  const t = new Date('1970-01-01T00:30:00Z'); // Unix epoch start.
  t.setSeconds(secs);
  return t;
};
