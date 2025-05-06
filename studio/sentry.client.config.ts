// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { init, replayIntegration } from "@sentry/nextjs";

const isSentryEnabled = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";
const isSentryFeatureReplayEnabled =
  isSentryEnabled && process.env.NEXT_PUBLIC_SENTRY_REPLAY_ENABLED === "true";

const integrations = [];

if (isSentryFeatureReplayEnabled) {
  integrations.push(
    replayIntegration({
      // minimum duration of a replay before it's sent to sentry
      // capped at max 15s
      minReplayDuration: parseFloat(
        process.env.NEXT_PUBLIC_SENTRY_REPLAY_MIN_REPLAY_DURATION || "15",
      ),
      maskAllText: true,
      blockAllMedia: true,
    }),
  );
}

init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: process.env.SENTRY_DEBUG === "true",
  /**
   * A global sample rate to apply to all events.
   *
   * 0.0 = 0% chance of a given event being sent (send no events) 1.0 = 100% chance of a given event being sent (send
   * all events)
   */
  sampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_SAMPLE_RATE || "0",
  ),
  /**
   * Sample rate to determine trace sampling.
   *
   * 0.0 = 0% chance of a given trace being sent (send no traces) 1.0 = 100% chance of a given trace being sent (send
   * all traces)
   *
   * Tracing is enabled if either this or `tracesSampler` is defined. If both are defined, `tracesSampleRate` is
   * ignored.
   */
  tracesSampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_TRACES_SAMPLE_RATE || "0",
  ),
  /**
   * The sample rate for sessions that has had an error occur.
   * This is independent of `sessionSampleRate`.
   * 1.0 will record all sessions and 0 will record none.
   */
  replaysOnErrorSampleRate: isSentryFeatureReplayEnabled ? parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_REPLAYS_ON_ERROR_SAMPLE_RATE || "0",
  ) : 0,
  /**
   * The sample rate for session-long replays.
   * 1.0 will record all sessions and 0 will record none.
   */
  replaysSessionSampleRate: isSentryFeatureReplayEnabled ? parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_REPLAYS_SESSION_SAMPLE_RATE || "0",
  ) : 0,
  integrations,
});
