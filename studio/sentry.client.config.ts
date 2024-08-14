// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const sentryDsn = process.env.SENTRY_DSN;
const sentryClientSampleRate = parseFloat(
  process.env.SENTRY_CLIENT_SAMPLE_RATE || "1",
);
const sentryDebugEnabled = process.env.SENTRY_DEBUG === "false";

Sentry.init({
  dsn: sentryDsn,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: sentryClientSampleRate,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: sentryDebugEnabled,
  replaysOnErrorSampleRate: 1.0,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
