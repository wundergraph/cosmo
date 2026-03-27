import { ReactNode, createContext, useEffect } from 'react';
import Router from 'next/router';
import { useOnboarding } from '@/hooks/use-onboarding';

export interface OnboardingContextValue {
  enabled: boolean;
}

export const OnboardingContext = createContext<OnboardingContextValue>({ enabled: false });

const ONBOARDING_PATH = '/[organizationSlug]/onboarding';

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const onboarding = useOnboarding();

  useEffect(
    function handleRedirectInOnboardingProvider() {
      if (!onboarding.enabled) return;
      if (Router.pathname === ONBOARDING_PATH) return;

      const slug = Router.query.organizationSlug as string;
      if (!slug) return;

      // Using static Router instance so this effect is not triggered on route changes
      Router.replace(`/${slug}/onboarding`);
    },
    [onboarding.enabled],
  );

  return <OnboardingContext.Provider value={onboarding}>{children}</OnboardingContext.Provider>;
};
