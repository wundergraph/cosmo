// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import *as Sentry from "@sentry/nextjs";

const isSentryEnabled = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";
const isSentryFeatureReplayEnabled = isSentryEnabled && (process.env.NEXT_PUBLIC_SENTRY_REPLAY_ENABLED === "true");
const isSentryFeatureFeedbackFormEnabled = isSentryEnabled && (process.env.NEXT_PUBLIC_SENTRY_FEEBACK_FORM_ENABLED === "true");

const integrations = []

if (isSentryFeatureReplayEnabled) {
  integrations.push(
    Sentry.replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
    }),
  )
}

if (isSentryFeatureFeedbackFormEnabled) {
  integrations.push(
    Sentry.feedbackIntegration({
      id: "sentry-feedback-form",
      // useSentryUser is populated on user login
      showBranding: false,
      autoInject: true,
      isEmailRequired: true,
      isNameRequired: true,
      showEmail: true,
      enableScreenshot: true,

      triggerAriaLabel: "label-open",
      cancelButtonLabel: "Back",
      submitButtonLabel: "Send Message",
      confirmButtonLabel: "Send Message",
      successMessageText: "Your message has been sent. We’ll get back to you soon. For quicker responses, feel free to reach out to us on Discord!",

      triggerLabel: "How can we help you?",
      formTitle: "We're here to help!",
      nameLabel: "Full Name",
      namePlaceholder: "e.g., John Doe",
      emailLabel: "Email Address",
      emailPlaceholder: "e.g., john.doe@example.com",
      messageLabel: "How Can We Help?",
      messagePlaceholder: "Type your message here...",

      isRequiredLabel: "required",
      addScreenshotButtonLabel: "Capture Screenshot",
      removeScreenshotButtonLabel: "remove a screenshot",
      colorScheme: "system",
    }),
  )
}

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
