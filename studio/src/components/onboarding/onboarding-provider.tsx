import { ReactNode, useEffect } from 'react';
import Router from 'next/router';
import { useFeatureFlags } from '@/components/feature-flag-provider';

const ONBOARDING_PATH_PREFIX = '/onboarding';

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const { onboarding } = useFeatureFlags();

  useEffect(
    function handleRedirectInOnboardingProvider() {
      if (!onboarding.enabled) return;
      if (Router.pathname.startsWith(ONBOARDING_PATH_PREFIX)) return;

      Router.replace('/onboarding');
    },
    [onboarding.enabled],
  );

  return children;
};
