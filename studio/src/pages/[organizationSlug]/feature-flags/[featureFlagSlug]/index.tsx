import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFeatureFlagByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { FeatureFlagDetails } from "@/components/feature-flag-details";
import { useWorkspace } from "@/hooks/use-workspace";
import { NamespaceSelector } from "@/components/dashboard/namespace-selector";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const FeatureFlagDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { namespace: { name: namespace } } = useWorkspace();
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
        federatedGraphs={data.federatedGraphs.map((g) => {
          return {
            federatedGraph: g.federatedGraph!,
            isConnected: g.isConnected,
          };
        })}
      />
    </div>
  );
};

const FeatureFlagBreadcrumb = () => {
  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();

  return (
    <div className="flex h-8 items-center justify-center">
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
    [
      <NamespaceSelector
        isViewingGraphOrSubgraph={false}
        truncateNamespace
        key={1}
      />,
      <FeatureFlagBreadcrumb key={2} />,
      <FeatureFlagNameBreadcrumb key={3} />,
    ],
    true,
  );
};

export default FeatureFlagDetailsPage;
