import { useContext } from 'react';
import { OnboardingContext, type OnboardingState } from '@/components/onboarding/onboarding-provider';

export function useOnboarding(): OnboardingState {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error('useOnboarding must be used within <OnboardingProvider>');
  }

  return context;
}
