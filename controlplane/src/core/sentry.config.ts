// sentry.config.ts
import * as Sentry from '@sentry/node';

import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { eventLoopBlockIntegration } from '@sentry/node-native';

export interface SentryConfig {
  sentry: {
    enabled: boolean;
    dsn: string;
    eventLoopBlockIntegrationThresholdMs?: number;
    profileSessionSampleRate?: number;
    sendDefaultPii?: boolean;
    tracesSampleRate?: number;
  };
}

export function init(opts: SentryConfig) {
  if (opts.sentry.enabled) {
    Sentry.init({
      dsn: opts.sentry.dsn,
      integrations: [
        eventLoopBlockIntegration({ threshold: opts.sentry.eventLoopBlockIntegrationThresholdMs }),
        nodeProfilingIntegration(),
      ],
      profileSessionSampleRate: opts.sentry.profileSessionSampleRate,
      sendDefaultPii: opts.sentry.sendDefaultPii,
      tracesSampleRate: opts.sentry.tracesSampleRate,
    });
  }
}
