import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';

export const Step3 = () => {
  const { setStep, setSkipped } = useOnboarding();

  useEffect(() => {
    setStep(3);
  }, [setStep]);

  return (
    <OnboardingContainer>
      <h2 className="text-2xl font-semibold tracking-tight">Step 3</h2>
      <OnboardingNavigation onSkip={setSkipped} backHref="/onboarding/2" forward={{ href: '/onboarding/4' }} />
    </OnboardingContainer>
  );
};
