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

// RPC paths we always trace at 100%, regardless of SENTRY_TRACES_SAMPLE_RATE. Batch
// subgraph publishes are rare, slow, and frequently hit the request timeout — we want a
// trace for every one so their end-to-end composition cost can be tracked. Child spans
// (e.g. ComposeGraphsWorker.composeGraphsInWorker) inherit the parent's sampling decision.
const ALWAYS_SAMPLE_PATHS = ['/wg.cosmo.platform.v1.PlatformService/PublishFederatedSubgraphs'];

const publishAwareTracesSampler: NonNullable<Sentry.NodeOptions['tracesSampler']> = (ctx) => {
  const attrs = ctx.attributes ?? {};
  const target = [ctx.name, attrs['http.route'], attrs['http.target'], attrs['url.path'], attrs['url.full']]
    .filter(Boolean)
    .join(' ');

  // Batch publishes are always traced, regardless of the base rate or any upstream decision.
  if (ALWAYS_SAMPLE_PATHS.some((path) => target.includes(path))) {
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
