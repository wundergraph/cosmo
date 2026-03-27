import { OnboardingForm } from '@/components/onboarding/onboarding-form';
import { getOnboardingLayout } from '@/components/onboarding/onboarding-layout';
import type { NextPageWithLayout } from '@/lib/page';

const WelcomePage: NextPageWithLayout = () => {
  return <OnboardingForm />;
};

WelcomePage.getLayout = (page) => {
  return getOnboardingLayout(page, 0);
};

export default WelcomePage;
