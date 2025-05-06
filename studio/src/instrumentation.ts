export async function register() {
  const isSentryEnabled = process.env.NEXT_PUBLIC_SENTRY_ENABLED === "true";
  if (isSentryEnabled) {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("../sentry.server.config");
    }

    if (process.env.NEXT_RUNTIME === "edge") {
      await import("../sentry.edge.config");
    }
  }
}
