import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingNavigation } from './onboarding-navigation';

export const Step2 = () => {
  const { setStep, setSkipped } = useOnboarding();

  useEffect(() => {
    setStep(2);
  }, [setStep]);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">Step 3</h2>
      <OnboardingNavigation onSkip={setSkipped} backHref="/onboarding/2" forward={{ href: '/onboarding/4' }} />
    </div>
  );
};
