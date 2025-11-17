import { createRequire } from 'node:module';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { eventLoopBlockIntegration } from '@sentry/node-native';
import { fastifyIntegration, pinoIntegration } from '@sentry/node';
import { envVariables } from './env.schema.js';

const {
  SENTRY_ENABLED,
  SENTRY_DSN,
  SENTRY_SEND_DEFAULT_PII,
  SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  SENTRY_PROFILE_LIFECYCLE,
  SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS,
  SENTRY_ENABLE_LOGS,
} = envVariables.parse(process.env);

if (SENTRY_ENABLED && SENTRY_DSN) {
  const require = createRequire(import.meta.url);
  let release: string | undefined;
  try {
    const pkg = require('../../package.json') as { version?: string };
    release = pkg.version;
  } catch (error) {
    console.debug('Sentry: failed to read package.json version for release', error);
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    release,
    integrations: [
      fastifyIntegration(),
      eventLoopBlockIntegration({ threshold: SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS }),
      nodeProfilingIntegration(),
      pinoIntegration({ log: { levels: ['info', 'warn', 'error'] } }),
    ],
    profileSessionSampleRate: SENTRY_PROFILE_SESSION_SAMPLE_RATE,
    sendDefaultPii: SENTRY_SEND_DEFAULT_PII,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    profileLifecycle: SENTRY_PROFILE_LIFECYCLE,
    enableLogs: SENTRY_ENABLE_LOGS,
  });
  console.log('Sentry is initialized.');
}
