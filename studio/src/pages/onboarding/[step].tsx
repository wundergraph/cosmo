import { OnboardingLayout } from '@/components/layout/onboarding-layout';
import { Step1 } from '@/components/onboarding/step-1';
import { Step2 } from '@/components/onboarding/step-2';
import { Step3 } from '@/components/onboarding/step-3';
import { Step4 } from '@/components/onboarding/step-4';
import { NextPageWithLayout } from '@/lib/page';
import { useRouter } from 'next/router';

const OnboardingStep: NextPageWithLayout = () => {
  const router = useRouter();
  const { step } = router.query;

  switch (step) {
    case '0':
    case '1':
      return (
        <OnboardingLayout title="Information about you">
          <Step1 />
        </OnboardingLayout>
      );
    case '2':
      return (
        <OnboardingLayout title="What is GraphQL Federation?">
          <Step2 />
        </OnboardingLayout>
      );
    case '3':
      return (
        <OnboardingLayout title="Create your first graph">
          <Step3 />
        </OnboardingLayout>
      );
    case '4':
      return (
        <OnboardingLayout title="Run your services">
          <Step4 />
        </OnboardingLayout>
      );
    default:
      return null;
  }
};

OnboardingStep.getLayout = (page) => page;

export default OnboardingStep;
