// Tracking. This will be available if the following scripts are embedded though CUSTOM_HEAD_SCRIPTS
// Reo, PostHog

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

  PostHogClient().reset();
};

type IdentifyUserInput = {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  plan?: string;
};

const syncPostHogIdentity = (
  posthogClient: ReturnType<typeof PostHogClient>,
  { email, id, organizationId, organizationName, organizationSlug, plan }: IdentifyUserInput,
) => {
  const currentDistinctId = posthogClient.get_distinct_id();

  if (currentDistinctId && currentDistinctId !== email) {
    posthogClient.alias(email, currentDistinctId);
  }

  posthogClient.identify(email, {
    id,
    email,
    organizationId,
    organizationName,
    organizationSlug,
    plan,
  });

  if (organizationSlug) {
    posthogClient.group('orgslug', organizationSlug);
  }
};

const identify = (input: IdentifyUserInput) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  // Identify with Reo
  window.Reo?.identify({
    username: input.email,
    type: 'email',
  });

  syncPostHogIdentity(PostHogClient(), input);
};

export { resetTracking, identify, syncPostHogIdentity };
