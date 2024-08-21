// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { init, replayIntegration, feedbackIntegration } from "@sentry/nextjs";

const isSentryEnabled = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";
const isSentryFeatureReplayEnabled =
  isSentryEnabled && process.env.NEXT_PUBLIC_SENTRY_REPLAY_ENABLED === "true";

const isSentryFeatureFeedbackFormEnabled =
  isSentryEnabled &&
  process.env.NEXT_PUBLIC_SENTRY_FEEBACK_FORM_ENABLED === "true";

const integrations = [];

if (isSentryFeatureReplayEnabled) {
  integrations.push(
    replayIntegration({
      // Additional Replay configuration goes in here, for example:
      maskAllText: true,
      blockAllMedia: true,
    }),
  );
}

if (isSentryFeatureFeedbackFormEnabled) {
  integrations.push(
    feedbackIntegration({
      id: "sentry-feedback-form",
      showBranding:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_SHOW_BRANDING === "true",
      autoInject:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_AUTO_INJECT === "true",
      isEmailRequired:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_IS_EMAIL_REQUIRED ===
        "true",
      isNameRequired:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_IS_NAME_REQUIRED ===
        "true",
      showEmail:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_SHOW_EMAIL === "true",
      enableScreenshot:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_ENABLE_SCREENSHOT ===
        "true",
      triggerAriaLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_TRIGGER_ARIA_LABEL ||
        "label-open",
      cancelButtonLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_CANCEL_BUTTON_LABEL ||
        "Back",
      submitButtonLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_SUBMIT_BUTTON_LABEL ||
        "Send Message",
      confirmButtonLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_CONFIRM_BUTTON_LABEL ||
        "Send Message",
      successMessageText:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_SUCCESS_MESSAGE_TEXT ||
        "Your message has been sent. We’ll get back to you soon. For quicker responses, feel free to reach out to us on Discord!",
      triggerLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_TRIGGER_LABEL ||
        "How can we help you?",
      formTitle:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_TITLE ||
        "We're here to help!",
      nameLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_NAME_LABEL || "Full Name",
      namePlaceholder:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_NAME_PLACEHOLDER ||
        "e.g., John Doe",
      emailLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_EMAIL_LABEL ||
        "Email Address",
      emailPlaceholder:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_EMAIL_PLACEHOLDER ||
        "e.g., john.doe@example.com",
      messageLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_MESSAGE_LABEL ||
        "How Can We Help?",
      messagePlaceholder:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_MESSAGE_PLACEHOLDER ||
        "Type your message here...",
      isRequiredLabel:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_IS_REQUIRED_LABEL ||
        "required",
      addScreenshotButtonLabel:
        process.env
          .NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_ADD_SCREENSHOT_BUTTON_LABEL ||
        "Capture Screenshot",
      removeScreenshotButtonLabel:
        process.env
          .NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_REMOVE_SCREENSHOT_BUTTON_LABEL ||
        "Remove a screenshot",
      colorScheme:
        process.env.NEXT_PUBLIC_SENTRY_FEEDBACK_FORM_COLOR_SCHEME || "system",
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
  replaysOnErrorSampleRate: isSentryFeatureReplayEnabled
    ? parseFloat(
        process.env.NEXT_PUBLIC_SENTRY_CLIENT_REPLAYS_ON_ERROR_SAMPLE_RATE ||
          "0",
      )
    : 0,
  /**
   * The sample rate for session-long replays.
   * 1.0 will record all sessions and 0 will record none.
   */
  replaysSessionSampleRate: isSentryFeatureReplayEnabled
    ? parseFloat(
        process.env.NEXT_PUBLIC_SENTRY_CLIENT_REPLAYS_SESSION_SAMPLE_RATE ||
          "0",
      )
    : 0,
  integrations,
});
