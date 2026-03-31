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
      return <Step1 />;
    case '2':
      return <Step2 />;
    case '3':
      return <Step3 />;
    default:
      return null;
  }
};

OnboardingStep.getLayout = (page) => <OnboardingLayout>{page}</OnboardingLayout>;

export default OnboardingStep;
