// Tracking. This will be available if the following scripts are embedded though CUSTOM_HEAD_SCRIPTS
// Reo, PostHog

import posthog from 'posthog-js';

declare global {
  interface Window {
    ko: any;
    Reo: any;
  }
}

const resetTracking = () => {
  if (typeof window === 'undefined') {
    return;
  }

  posthog.reset();
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
  if (typeof window === 'undefined') {
    return;
  }

  // We allow PostHog tracking for any environment, if the key is provided
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    // Identify with PostHog
    // We use the id posthog sets to identify the user. This way we do not lose cross domain tracking.
    posthog.identify(posthog.get_distinct_id(), {
      id,
      email,
      organizationId,
      organizationName,
      organizationSlug,
      plan,
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  // Identify with Reo
  window.Reo?.identify({
    username: email,
    type: 'email',
  });
};

export { resetTracking, identify };
