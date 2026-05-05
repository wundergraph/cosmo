// Tracking. This will be available if the following scripts are embedded though CUSTOM_HEAD_SCRIPTS
// Reo, PostHog

import posthog, { type PostHog } from 'posthog-js';

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

const setupReo = (email: string) => {
  // Identify with Reo
  window.Reo?.identify({
    username: email,
    type: 'email',
  });
};

const setupPosthog = ({
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
  // We allow PostHog tracking for any environment, if the key is provided
  // Identify with PostHog
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
  } else {
    posthog.identify(email, {
      id,
    });
    posthog.group('cosmo_organization', organizationId, {
      id: organizationId,
      slug: organizationSlug,
      name: organizationName,
      plan: plan,
    });
  }
  posthog.reloadFeatureFlags();
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

  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    setupPosthog({
      email,
      id,
      organizationId,
      organizationName,
      organizationSlug,
      plan,
    });
  }

  if (process.env.NODE_ENV === 'production') {
    setupReo(email);
  }
};

/**
 * IDs in this type are ordered. They correspond to [cosmo-onboarding-v1] onboarding version
 */
type OnboardingStepId =
  | 'welcome'
  | 'onboarding_comm_channel_set_opt'
  | 'create_graph'
  | 'run_router_send_metrics'
  | 'onboarding_users_invited_opt'
  | 'onboarding_docs_visit_opt'
  | 'take_me_in_click_opt';
type OnboardingTrackEvent =
  | {
      name: 'onboarding_started';
      options: {
        /** can be [wgc] or referring URL */
        entry_source?: string;
      };
    }
  | {
      name: 'onboarding_step_completed';
      options: {
        step_name: Exclude<OnboardingStepId, 'onboarding_users_invited_opt' | 'welcome'>;
      };
    }
  | {
      name: 'onboarding_step_completed';
      options: {
        step_name: 'welcome';
        channel: string[];
      };
    }
  | {
      name: 'onboarding_step_completed';
      options: {
        step_name: 'onboarding_users_invited_opt';
        users_invited: number;
      };
    }
  | {
      name: 'onboarding_skipped';
      options: {
        step_name: OnboardingStepId;
      };
    }
  | {
      name: 'onboarding_step_failed';
      options: {
        step_name: OnboardingStepId;
        /** can be [wgc] */
        entry_source?: string;
        /**
         * + [resource] - CRUD operation failures, such as onboarding record created
         *   in the database, updating communication channels, creating federated
         *   graph & plugin publish (CLI)
         * + [router] - failures when running the router via CLI
         * + [metrics] - sending metrics fails (CLI) or metrics are not detected
         *   within permitted time window (web)
         * + [invites] - failed to send invites after finishing the onboarding
         */
        error_category: 'resource' | 'router' | 'metrics' | 'invites';
        error_message: string;
      };
    }
  | {
      name: 'onboarding_completed';
      options: {
        step_name: 'take_me_in_click_opt';
      };
    };

const captureOnboardingEvent = (client: PostHog, event: OnboardingTrackEvent): void => {
  client.capture(event.name, event.options);
};

export { resetTracking, identify, captureOnboardingEvent };
