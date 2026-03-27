import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import type { NextPageWithLayout } from '@/lib/page';

const OnboardingPage: NextPageWithLayout = () => {
  return (
    <>
      <h2>TODO</h2>
    </>
  );
};

OnboardingPage.getLayout = (page) => {
  return getDashboardLayout(page, 'Onboarding', 'Discover Cosmo platform');
};

export default OnboardingPage;
