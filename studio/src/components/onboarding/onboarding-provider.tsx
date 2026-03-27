import { ReactNode, useEffect } from 'react';
import Router from 'next/router';
import { useFeatureFlags } from '@/components/feature-flag-provider';

const ONBOARDING_PATH = '/[organizationSlug]/onboarding';

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const { onboarding } = useFeatureFlags();

  useEffect(
    function handleRedirectInOnboardingProvider() {
      if (!onboarding.enabled) return;
      if (Router.pathname === ONBOARDING_PATH) return;

      const slug = Router.query.organizationSlug as string;
      if (!slug) return;

      Router.replace(`/${slug}/onboarding`);
    },
    [onboarding.enabled],
  );

  return children;
};
