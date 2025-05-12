// Tracking. This will be available if the following scripts are embedded though CUSTOM_HEAD_SCRIPTS
// Koala, Reo, PostHog

import posthog from "posthog-js";
import PostHogClient from "./posthog";

declare global {
  interface Window {
    ko: any;
    Reo: any;
  }
}

const resetTracking = () => {
  if (typeof window === "undefined") {
    return;
  }

  posthog.reset();
  window.ko?.reset;
};

const identify = ({
  email,
  id,
  organizationId,
  organizationName,
  organizationSlug,
  plan,
}: {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  plan?: string;
}) => {
  if (typeof window === "undefined") {
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    return;
  }

  // Identify with Koala
  window.ko?.identify(email, {
    id,
    $account: {
      organizationId,
      organizationName,
      organizationSlug,
      plan,
    },
  });

  // Identify with Reo
  window.Reo?.identify({
    username: email,
    type: "email",
  });

  // Identify with PostHog
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    const posthog = PostHogClient();
    posthog.identify(id, {
      email,
      organizationId,
      organizationName,
      organizationSlug,
      plan,
    });
  }
};

export { resetTracking, identify };
