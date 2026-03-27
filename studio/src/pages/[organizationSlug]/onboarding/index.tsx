import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { OnboardingForm } from '@/components/onboarding/onboarding-form';
import type { NextPageWithLayout } from '@/lib/page';

const OnboardingPage: NextPageWithLayout = () => {
  return <OnboardingForm />;
};

OnboardingPage.getLayout = (page) => {
  return getDashboardLayout(page, 'Onboarding', 'Discover Cosmo platform');
};

export default OnboardingPage;
