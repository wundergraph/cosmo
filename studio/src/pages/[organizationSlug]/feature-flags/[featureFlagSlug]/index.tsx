import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFeatureFlagByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { Button } from "react-day-picker";
import Link from "next/link";
import { FeatureFlagDetails } from "@/components/feature-flag-details";

const FeatureFlagDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const namespace = router.query.namespace as string;
  const slug = router.query.featureFlagSlug as string;

  const { data, isLoading, error, refetch } = useQuery(getFeatureFlagByName, {
    name: slug,
    namespace,
  });

  if (isLoading) return <Loader fullscreen />;

  if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.featureFlag
  )
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve your feature flag"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="flex h-full flex-col">
      <FeatureFlagDetails
        featureFlag={data.featureFlag}
        featureSubgraphs={data.featureSubgraphs}
        federatedGraphs={data.federatedGraphs}
      />
    </div>
  );
};

const FeatureFlagBreadcrumb = () => {
  const router = useRouter();
  const organizationSlug = router.query.organizationSlug as string;
  const namespace = router.query.namespace as string;

  return (
    <div className="h-8 flex justify-center items-center">
      <Link
        key={organizationSlug + namespace}
        href={`/${organizationSlug}/feature-flags?namespace=${namespace}`}
      >
        Feature Flags
      </Link>
    </div>
  );
};

const FeatureFlagNameBreadcrumb = () => {
  const router = useRouter();
  const featureFlagSlug = router.query.featureFlagSlug as string;

  return <p>{featureFlagSlug}</p>;
};

FeatureFlagDetailsPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Details",
    "A quick glance of the details for this feature flag.",
    undefined,
    undefined,
    [<FeatureFlagBreadcrumb key={0} />, <FeatureFlagNameBreadcrumb key={1} />],
    true,
  );
};

export default FeatureFlagDetailsPage;
