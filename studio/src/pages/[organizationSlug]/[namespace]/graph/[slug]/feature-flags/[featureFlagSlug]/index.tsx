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
import { Button } from "react-day-picker";

const FeatureFlagDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = router.query.organizationSlug as string;
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
      <GraphPageLayout
        title={slug}
        subtitle="A quick glance of the details for this feature flag"
        breadcrumbs={[
          <Link
            key={slug}
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
      title={slug}
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
        federatedGraphs={data.federatedGraphs}
      />
    </GraphPageLayout>
  );
};

FeatureFlagDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Feature Flag Details",
  });

export default FeatureFlagDetailsPage;
