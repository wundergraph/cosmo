import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';

export const Step2 = () => {
  const { setStep, setSkipped } = useOnboarding();

  useEffect(() => {
    setStep(2);
  }, [setStep]);

  return (
    <OnboardingContainer>
      <h2 className="text-2xl font-semibold tracking-tight">Step 2</h2>
      <OnboardingNavigation onSkip={setSkipped} backHref="/onboarding/1" forward={{ href: '/onboarding/3' }} />
    </OnboardingContainer>
  );
};
