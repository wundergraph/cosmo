import { EmptyState } from "@/components/empty-state";
import { FeatureFlagDetails } from "@/components/feature-flag-details";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFeatureFlagByName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const FeatureFlagDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const featureFlagSlug = router.query.featureFlagSlug as string;

  const { data, isLoading, error, refetch } = useQuery(getFeatureFlagByName, {
    name: featureFlagSlug,
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
      <GraphPageLayout
        title={featureFlagSlug}
        subtitle="A quick glance of the details for this feature flag"
        breadcrumbs={[
          <Link
            key={featureFlagSlug}
            href={`/${organizationSlug}/${namespace}/graph/${slug}/feature-flags`}
          >
            Feature Flags
          </Link>,
        ]}
        noPadding
      >
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve your feature flag"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </GraphPageLayout>
    );

  return (
    <GraphPageLayout
      title={featureFlagSlug}
      subtitle="A quick glance of the details for this feature flag"
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/feature-flags`}
        >
          Feature Flags
        </Link>,
      ]}
      noPadding
    >
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
    </GraphPageLayout>
  );
};

FeatureFlagDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Feature Flag Details",
  });

export default FeatureFlagDetailsPage;
