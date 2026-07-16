import { Loader } from '@/components/ui/loader';
import { NextPageWithLayout } from '@/lib/page';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { buildUrl } from '@/lib/build-url';

const DashboardPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { organizationSlug } = router.query;

  useEffect(() => {
    if (!organizationSlug) return;
    const url = new URL(window.location.origin + router.basePath + router.asPath);
    const params = new URLSearchParams(url.search);
    const link = buildUrl('/:organizationSlug/graphs', { organizationSlug: organizationSlug as string });

    router.replace(params.size !== 0 ? `${link}?${params}` : link);
  }, [router, organizationSlug]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <Loader />
    </div>
  );
};

DashboardPage.getLayout = (page) => page;

export default DashboardPage;
