import os from 'node:os';
import process from 'node:process';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { eventLoopBlockIntegration } from '@sentry/node-native';
import { fastifyIntegration, pinoIntegration } from '@sentry/node';
import { sentryEnvVariables } from './env.schema.js';

const {
  SENTRY_ENABLED,
  SENTRY_DSN,
  SENTRY_SEND_DEFAULT_PII,
  SENTRY_TRACES_SAMPLE_RATE,
  SENTRY_PROFILE_SESSION_SAMPLE_RATE,
  SENTRY_PROFILE_LIFECYCLE,
  SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS,
  SENTRY_ENABLE_LOGS,
} = sentryEnvVariables.parse(process.env);

// RPC paths we always trace at 100%, regardless of SENTRY_TRACES_SAMPLE_RATE.
const ALWAYS_SAMPLE_PATHS = ['/wg.cosmo.platform.v1.PlatformService/PublishFederatedSubgraphs'];

const matchesAlwaysSample = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }
  for (const path of ALWAYS_SAMPLE_PATHS) {
    if (value.includes(path)) {
      return true;
    }
  }
  return false;
};

const publishAwareTracesSampler: NonNullable<Sentry.NodeOptions['tracesSampler']> = (ctx) => {
  const attrs = ctx.attributes;

  // Some paths are always traced
  if (
    matchesAlwaysSample(ctx.name) ||
    (attrs &&
      [attrs['http.route'], attrs['http.target'], attrs['url.path'], attrs['url.full']].some((value) =>
        matchesAlwaysSample(value),
      ))
  ) {
    return 1;
  }

  // Otherwise honor an upstream sampling decision exactly so distributed traces stay intact:
  // a parent that opted out (parentSampled === false) must not leave orphaned child spans.
  if (typeof ctx.parentSampled === 'boolean') {
    return ctx.parentSampled ? 1 : 0;
  }

  return SENTRY_TRACES_SAMPLE_RATE;
};

if (SENTRY_ENABLED && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      fastifyIntegration(),
      eventLoopBlockIntegration({ threshold: SENTRY_EVENT_LOOP_BLOCK_THRESHOLD_MS }),
      nodeProfilingIntegration(),
      pinoIntegration({ log: { levels: ['info', 'warn', 'error'] } }),
    ],
    profileSessionSampleRate: SENTRY_PROFILE_SESSION_SAMPLE_RATE,
    sendDefaultPii: SENTRY_SEND_DEFAULT_PII,
    // tracesSampler takes precedence over tracesSampleRate; the sampler falls back to
    // SENTRY_TRACES_SAMPLE_RATE for everything that isn't in ALWAYS_SAMPLE_PATHS.
    tracesSampler: publishAwareTracesSampler,
    profileLifecycle: SENTRY_PROFILE_LIFECYCLE,
    enableLogs: SENTRY_ENABLE_LOGS,
    spotlight: process.env.NODE_ENV !== 'production',
  });

  Sentry.setTag('hostname', os.hostname());

  if (process.env.NODE_ENV !== 'production') {
    console.log('Sentry is initialized.');
  }
}
