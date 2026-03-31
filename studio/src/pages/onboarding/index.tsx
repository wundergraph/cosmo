import { OnboardingLayout } from '@/components/layout/onboarding-layout';
import { NextPageWithLayout } from '@/lib/page';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

const OnboardingIndex: NextPageWithLayout = () => {
  const router = useRouter();

  useEffect(() => {
    router.replace('/onboarding/1');
  }, [router]);

  return null;
};

OnboardingIndex.getLayout = (page) => <OnboardingLayout>{page}</OnboardingLayout>;

export default OnboardingIndex;
