// sentry.config.ts
import * as Sentry from '@sentry/node';

import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { eventLoopBlockIntegration } from '@sentry/node-native';

if (process.env.SENTRY_ENABLED) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      eventLoopBlockIntegration({ threshold: Number(process.env.SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS) }),
      nodeProfilingIntegration(),
    ],
    profileSessionSampleRate: Number(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE),
    sendDefaultPii: Boolean(process.env.SENTRY_SEND_DEFAULT_PII),
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE),
  });
}

export * as Sentry from '@sentry/node';
