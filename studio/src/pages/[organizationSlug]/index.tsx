import { NextPageWithLayout } from "@/lib/page";
import { useRouter } from "next/router";
import { useEffect } from "react";

const DashboardPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { organizationSlug } = router.query;

  useEffect(() => {
    if (!organizationSlug) return;
    const url = new URL(
      window.location.origin + router.basePath + router.asPath
    );
    const params = new URLSearchParams(url.search);
    router.replace(
      params
        ? `/${organizationSlug}/graphs?${params}`
        : `/${organizationSlug}/graphs`
    );
  }, [router, organizationSlug]);

  return null;
};

export default DashboardPage;
