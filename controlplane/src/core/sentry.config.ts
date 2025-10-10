import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { eventLoopBlockIntegration } from '@sentry/node-native';
import { fastifyIntegration, pinoIntegration } from '@sentry/node';

if (process.env.SENTRY_ENABLED === 'true' && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      fastifyIntegration(),
      eventLoopBlockIntegration({ threshold: Number(process.env.SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS ?? 100) }),
      nodeProfilingIntegration(),
      pinoIntegration({ log: { levels: ['info', 'warn', 'error'] } }),
    ],
    profileSessionSampleRate: Number(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE ?? 1),
    sendDefaultPii: (process.env.SENTRY_SEND_DEFAULT_PII ?? 'true') === 'true',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1),
    profileLifecycle: (process.env.SENTRY_PROFILE_LIFECYCLE as 'trace' | 'manual') ?? 'trace',
    enableLogs: (process.env.SENTRY_ENABLE_LOGS ?? 'false') === 'true',
  });
  console.log('Sentry is initialized.');
}
