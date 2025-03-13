import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { GraphPruningLintConfig } from "@/components/lint-policy/graph-pruning-config";
import { LinterConfig } from "@/components/lint-policy/linter-config";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getNamespaceGraphPruningConfig,
  getNamespaceLintConfig
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";

const LintPolicyPage: NextPageWithLayout = () => {
  const router = useRouter();
  const namespace = router.query.namespace as string;
  const { data, isLoading, refetch, error } = useQuery(getNamespaceLintConfig, {
    namespace: namespace || "default",
  });

  const {
    data: graphPruningConfig,
    isLoading: fetchingGraphPruningConfig,
    refetch: refetchGraphPruningConfig,
    error: graphPruningConfigFetchError,
  } = useQuery(getNamespaceGraphPruningConfig, {
    namespace: namespace || "default",
  });

  if (isLoading || fetchingGraphPruningConfig) return <Loader fullscreen />;
  if (
    error ||
    graphPruningConfigFetchError ||
    !data ||
    !graphPruningConfig ||
    data?.response?.code !== EnumStatusCode.OK ||
    graphPruningConfig?.response?.code !== EnumStatusCode.OK
  )
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the lint policy of the namespace"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return (
    <div className="space-y-6">
      <LinterConfig data={data} refetch={refetch} />
      <GraphPruningLintConfig data={graphPruningConfig} refetch={refetchGraphPruningConfig} />
    </div>
  );
};

LintPolicyPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Lint Policy",
    "Configure the rules used for linting the subgraphs of the namespace.",
    undefined,
    undefined,
    [<NamespaceSelector key="0" />],
  );
};

export default LintPolicyPage;
