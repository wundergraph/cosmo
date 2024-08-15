// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
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
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_SAMPLE_RATE || "1",
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
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_TRACES_SAMPLE_RATE || "1",
  ),
  /**
   * The sample rate for sessions that has had an error occur.
   * This is independent of `sessionSampleRate`.
   * 1.0 will record all sessions and 0 will record none.
   */
  replaysOnErrorSampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_REPLAYS_ON_ERROR_SAMPLE_RATE || "1",
  ),
  /**
   * The sample rate for session-long replays.
   * 1.0 will record all sessions and 0 will record none.
   */
  replaysSessionSampleRate: parseFloat(
    process.env.NEXT_PUBLIC_SENTRY_CLIENT_REPLAYS_SESSION_SAMPLE_RATE || "1",
  ),

  integrations: [
    Sentry.feedbackIntegration({
      id: "feedback form",
      showBranding: false,
      autoInject: true,
      isEmailRequired: true,
      isNameRequired: true,
      showEmail: true,
      enableScreenshot: true,
      useSentryUser: {
        email: "foo@bar",
        name: "foo",
      },
      triggerLabel: "need help?",
      triggerAriaLabel: "label-open",
      cancelButtonLabel: "all good",
      submitButtonLabel: "submit question",
      confirmButtonLabel: "yes",
      formTitle: "Need Help?",
      emailLabel: "email?",
      emailPlaceholder: "email",
      messageLabel: "message",
      messagePlaceholder: "message place holder",
      nameLabel: "name",
      namePlaceholder: "another name",
      successMessageText: "success message",
      isRequiredLabel: "is required",
      addScreenshotButtonLabel: "take a screenshot",
      removeScreenshotButtonLabel: "remove a screenshot",
      colorScheme: "system",
    }),
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
