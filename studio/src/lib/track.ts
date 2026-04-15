// Tracking. This will be available if the following scripts are embedded though CUSTOM_HEAD_SCRIPTS
// Reo, PostHog

import posthog from 'posthog-js';
import PostHogClient from './posthog';

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

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  // Identify with Reo
  window.Reo?.identify({
    username: email,
    type: 'email',
  });

  // Identify with PostHog
  const posthog = PostHogClient();
  let distinctId = posthog.get_distinct_id();
  if (distinctId == organizationSlug) {
    // It was already identified with the old logic
    // We try to alias it, so if the email was never used, we can link the data
    posthog.alias(email);
    // to be sure we also reset the session so that if alias fail, we abandon the old session and start a new one
    // with the right data
    posthog.reset();
  } else if (distinctId === email) {
    // This session has been already identified, just keep the organization synchronized!
    posthog.group('cosmo_organization', organizationId, {
      id: organizationId,
      slug: organizationSlug,
      name: organizationName,
      plan: plan,
    });
    return;
  }

  posthog.identify(email, {
    id,
  });
  posthog.group('cosmo_organization', organizationId, {
    id: organizationId,
    slug: organizationSlug,
    name: organizationName,
    plan: plan,
  });
};

export { resetTracking, identify };
