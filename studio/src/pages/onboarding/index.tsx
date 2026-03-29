import { Step1Welcome } from '@/components/onboarding/step-1-welcome';
import { Step2Federation } from '@/components/onboarding/step-2-federation';
import { Step3CreateGraph } from '@/components/onboarding/step-3-create-graph';
import { Step4RunServices } from '@/components/onboarding/step-4-run-services';
import { getOnboardingLayout } from '@/components/onboarding/onboarding-layout';
import type { NextPageWithLayout } from '@/lib/page';

const OnboardingPage: NextPageWithLayout = () => {
  const step: number = 0;

  switch (step) {
    case 1:
      return <Step2Federation />;
    case 2:
      return <Step3CreateGraph />;
    case 3:
      return <Step4RunServices />;
    case 0:
    default:
      return <Step1Welcome />;
  }
};

OnboardingPage.getLayout = (page) => {
  return getOnboardingLayout(page, 0);
};

export default OnboardingPage;
