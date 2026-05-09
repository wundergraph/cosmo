import { useRef } from 'react';
import { OnboardingLayout } from '@/components/layout/onboarding-layout';
import { NextPageWithLayout } from '@/lib/page';
import Router from 'next/router';
import { useEffect } from 'react';
import { Loader } from '@/components/ui/loader';
import { useOnboarding } from '@/hooks/use-onboarding';

const OnboardingIndex: NextPageWithLayout = () => {
  const { currentStep } = useOnboarding();
  const initialStep = useRef(currentStep);

  useEffect(() => {
    // Only redirect user when they first enter
    Router.replace(initialStep.current ? `/onboarding/${initialStep.current}` : '/onboarding/1');
  }, []);

  return <Loader />;
};

OnboardingIndex.getLayout = (page) => <OnboardingLayout>{page}</OnboardingLayout>;

export default OnboardingIndex;
