import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { OnboardingForm } from '@/components/onboarding/onboarding-form';
import type { NextPageWithLayout } from '@/lib/page';

const WelcomePage: NextPageWithLayout = () => {
  return <OnboardingForm />;
};

WelcomePage.getLayout = (page) => {
  return getDashboardLayout(page, 'Onboarding', 'Discover Cosmo platform');
};

export default WelcomePage;
