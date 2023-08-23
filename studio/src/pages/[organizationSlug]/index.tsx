import { NextPageWithLayout } from "@/lib/page";
import { useRouter } from "next/router";
import { useEffect } from "react";

const DashboardPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { organizationSlug } = router.query;

  useEffect(() => {
    if(!organizationSlug) return
    router.replace(`/${organizationSlug}/graphs`);
  }, [router, organizationSlug]);

  return null;
};

export default DashboardPage;
