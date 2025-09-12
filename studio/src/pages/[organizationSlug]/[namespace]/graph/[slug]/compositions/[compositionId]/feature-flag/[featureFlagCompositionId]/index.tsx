import { EmptyState } from "@/components/empty-state";
import {
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { CompositionDetails } from "../..";
import { getCompositionDetails } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useQuery } from "@connectrpc/connect-query";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

const FeatureFlagCompositionDetailsPage: NextPageWithLayout = () => {
  const router = useRouter();

  const organizationSlug = useCurrentOrganization()?.slug;
  const { namespace: { name: namespace } } = useWorkspace();
  const slug = router.query.slug as string;
  const id = router.query.compositionId as string;
  const featureFlagCompositionId = router.query
    .featureFlagCompositionId as string;

  const { data, isLoading, error, refetch } = useQuery(getCompositionDetails, {
    compositionId: featureFlagCompositionId,
    namespace,
  });

  if (isLoading) return <Loader fullscreen />;

  if (
    error ||
    !data ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.composition
  )
    return (
      <GraphPageLayout
        title={featureFlagCompositionId}
        subtitle="A quick glance of the details for this feature flag composition"
        breadcrumbs={[
          <Link
            key={0}
            href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions/${id}`}
          >
            {id}
          </Link>,
        ]}
        noPadding
      >
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve composition details."
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </GraphPageLayout>
    );

  const { composition, compositionSubgraphs } = data;

  return (
    <GraphPageLayout
      title={featureFlagCompositionId}
      subtitle="A quick glance of the details for this feature flag composition"
      breadcrumbs={[
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions`}
        >
          Compositions
        </Link>,
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions/${id}`}
        >
          {id}
        </Link>,
        <Link
          key={0}
          href={`/${organizationSlug}/${namespace}/graph/${slug}/compositions/${id}?tab=ffCompostions`}
        >
          Feature Flag Compositions
        </Link>,
      ]}
      noPadding
    >
      <CompositionDetails
        composition={composition}
        changeCounts={undefined}
        compositionSubgraphs={compositionSubgraphs}
        featureFlagCompositions={undefined}
        isFeatureFlagComposition={true}
      />
    </GraphPageLayout>
  );
};

FeatureFlagCompositionDetailsPage.getLayout = (page) =>
  getGraphLayout(page, {
    title: "Feature Flag Composition Summary",
  });

export default FeatureFlagCompositionDetailsPage;
