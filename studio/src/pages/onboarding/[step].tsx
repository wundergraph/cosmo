import { OnboardingLayout } from '@/components/layout/onboarding-layout';
import { Step1 } from '@/components/onboarding/step-1';
import { Step2 } from '@/components/onboarding/step-2';
import { Step3 } from '@/components/onboarding/step-3';
import { NextPageWithLayout } from '@/lib/page';
import { useRouter } from 'next/router';

const OnboardingStep: NextPageWithLayout = () => {
  const router = useRouter();
  const { step } = router.query;

  switch (step) {
    case '0':
    case '1':
      return (
        <OnboardingLayout title="Get started with WunderGraph">
          <Step1 />
        </OnboardingLayout>
      );
    case '2':
      return (
        <OnboardingLayout title="Create your first graph">
          <Step2 />
        </OnboardingLayout>
      );
    case '3':
      return (
        <OnboardingLayout title="Run your services">
          <Step3 />
        </OnboardingLayout>
      )
    default:
      return null;
  }
};

OnboardingStep.getLayout = (page) => page;

export default OnboardingStep;
