import { Step1Welcome } from '@/components/onboarding/step-1-welcome';
import { getOnboardingLayout } from '@/components/onboarding/onboarding-layout';
import type { NextPageWithLayout } from '@/lib/page';

const OnboardingPage: NextPageWithLayout = () => {
  const step = 0;

  switch (step) {
    case 0:
    default:
      return <Step1Welcome />;
  }
};

OnboardingPage.getLayout = (page) => {
  return getOnboardingLayout(page, 0);
};

export default OnboardingPage;
