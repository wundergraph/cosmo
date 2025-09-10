import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { GraphPruningLintConfig } from "@/components/lint-policy/graph-pruning-config";
import { LinterConfig } from "@/components/lint-policy/linter-config";
import { ChecksConfig } from "@/components/checks/checks-config";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getNamespaceGraphPruningConfig,
  getNamespaceLintConfig,
  getNamespaceChecksConfig,
  getNamespaceProposalConfig,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { ProposalConfig } from "@/components/proposal/proposal-config";
import { useFeature } from "@/hooks/use-feature";
import { WorkspaceSelector } from "@/components/dashboard/workspace-selector";
import { useWorkspace } from "@/hooks/use-workspace";

const PoliciesPage: NextPageWithLayout = () => {
  const { namespace: { name: namespace } } = useWorkspace();
  const proposalsFeature = useFeature("proposals");

  const { data, isLoading, refetch, error } = useQuery(getNamespaceLintConfig, {
    namespace: namespace,
  });

  const {
    data: graphPruningConfig,
    isLoading: fetchingGraphPruningConfig,
    refetch: refetchGraphPruningConfig,
    error: graphPruningConfigFetchError,
  } = useQuery(getNamespaceGraphPruningConfig, { namespace: namespace });

  const {
    data: checksConfig,
    isLoading: isLoadingChecksConfig,
    refetch: refetchChecksConfig,
    error: checksConfigFetchError,
  } = useQuery(getNamespaceChecksConfig, { namespace: namespace });

  const {
    data: proposalConfig,
    isLoading: isLoadingProposalConfig,
    refetch: refetchProposalConfig,
    error: proposalConfigFetchError,
  } = useQuery(
    getNamespaceProposalConfig,
    {
      namespace: namespace,
    },
    {
      enabled: proposalsFeature?.enabled,
    },
  );

  const refetchAll = () => {
    if (error) {
      refetch();
    }

    if (refetchGraphPruningConfig) {
      refetchGraphPruningConfig();
    }

    if (refetchChecksConfig) {
      refetchChecksConfig();
    }

    if (refetchProposalConfig) {
      refetchProposalConfig();
    }
  };

  if (isLoading || fetchingGraphPruningConfig || isLoadingChecksConfig) {
    return <Loader fullscreen />;
  }

  if (
    error ||
    graphPruningConfigFetchError ||
    checksConfigFetchError ||
    !data ||
    !graphPruningConfig ||
    !checksConfig ||
    data?.response?.code !== EnumStatusCode.OK ||
    graphPruningConfig?.response?.code !== EnumStatusCode.OK ||
    checksConfig?.response?.code !== EnumStatusCode.OK ||
    (proposalsFeature?.enabled &&
      (!proposalConfig ||
        (proposalConfig?.response?.code !== EnumStatusCode.OK &&
          proposalConfig?.response?.code !== EnumStatusCode.ERR_UPGRADE_PLAN)))
  ) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve the policies for this namespace"
        description={
          data?.response?.details ||
          error?.message ||
          checksConfig?.response?.details ||
          checksConfigFetchError?.message ||
          graphPruningConfig?.response?.details ||
          graphPruningConfigFetchError?.message ||
          proposalConfig?.response?.details ||
          proposalConfigFetchError?.message ||
          "Please try again"
        }
        actions={<Button onClick={refetchAll}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <LinterConfig data={data} refetch={refetch} />
      <GraphPruningLintConfig
        data={graphPruningConfig}
        refetch={refetchGraphPruningConfig}
      />
      <ChecksConfig namespace={namespace} data={checksConfig} />
      {proposalsFeature?.enabled && proposalConfig && (
        <ProposalConfig
          key={proposalConfig.enabled ? "enabled" : "disabled"}
          data={proposalConfig}
          refetch={refetchProposalConfig}
        />
      )}
    </div>
  );
};

PoliciesPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Policies",
    "Configure various policies for subgraphs in the namespace.",
    undefined,
    undefined,
    [<WorkspaceSelector key="0" />],
  );
};

export default PoliciesPage;
