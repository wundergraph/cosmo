import posthog from "posthog-js";

export default function PostHogClient() {
  const posthogClient = posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    debug: process.env.NODE_ENV === "development",
  });
  return posthogClient;
}
