import { EmptyState } from "@/components/empty-state";
import {
  FeatureFlagPageLayout,
  getFeatureFlagLayout
} from "@/components/layout/feature-flag-layout";
import { SubgraphsTable } from "@/components/subgraphs-table";
import { Button } from "@/components/ui/button";
import { CLI } from "@/components/ui/cli";
import { Loader } from "@/components/ui/loader";
import { docsBaseURL } from "@/lib/constants";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { CommandLineIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFeatureSubgraphsByFeatureFlag
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";

export const Empty = ({ labels }: { labels: string[] }) => {
  const router = useRouter();

  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create a federated graph which includes this subgraph."
      description={
        <>
          No federated graphs include this subgraph. Create a federated graph
          with subgraph labels{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/federated-graph/create"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <CLI
          command={`npx wgc federated-graph create production --namespace ${
            router.query.namespace
          } --label-matcher ${labels.join(
            " ",
          )} --routing-url http://localhost:4000/graphql`}
        />
      }
    />
  );
};

const FeatureSubgraphsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const featureFlagSlug = router.query.featureFlagSlug as string;
  const namespace = router.query.namespace as string;

  const { data, error, refetch, isLoading } = useQuery(
    getFeatureSubgraphsByFeatureFlag,
    {
      featureFlagName: featureFlagSlug,
      namespace,
    },
    {
      enabled: !!featureFlagSlug,
    },
  );

  if (isLoading) {
    return <Loader fullscreen />;
  }

  if (error || !data || data.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the feature subgraphs that are a part of this feature flag."
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <SubgraphsTable
      subgraphs={data.featureSubgraphs}
      totalCount={data.featureSubgraphs.length}
    />
  );
};

FeatureSubgraphsPage.getLayout = (page) =>
  getFeatureFlagLayout(
    <FeatureFlagPageLayout
      title="Feature Subgraphs"
      subtitle="View the feature subgraphs that are a part of this feature flag."
    >
      {page}
    </FeatureFlagPageLayout>,
    { title: "Feature Subgraphs" },
  );

export default FeatureSubgraphsPage;
