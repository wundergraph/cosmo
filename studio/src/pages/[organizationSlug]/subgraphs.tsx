import { useApplyParams } from "@/components/analytics/use-apply-params";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { SubgraphPageTabs, SubgraphsTable } from "@/components/subgraphs-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getFeatureSubgraphs,
  getSubgraphs,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { WorkspaceSelector } from "@/components/dashboard/workspace-selector";
import { useWorkspace } from "@/hooks/use-workspace";

const SubgraphsDashboardPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { namespace: { name: namespace } } = useWorkspace();
  const tab = router.query.tab as string;

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const pageSize = Number.parseInt((router.query.pageSize as string) || "10");
  const limit = pageSize > 50 ? 50 : pageSize;
  const offset = (pageNumber - 1) * limit;

  const [search, setSearch] = useState(router.query.search as string);
  const [query] = useDebounce(search, 500);

  const applyParams = useApplyParams();

  const { data, isLoading, error, refetch } = useQuery(getSubgraphs, {
    namespace: namespace,
    query,
    limit,
    offset,
    excludeFeatureSubgraphs: true,
  });

  const {
    data: featureSubgraphsData,
    isLoading: fsLoading,
    error: fsError,
    refetch: refetchFeatureSubgraphs,
  } = useQuery(getFeatureSubgraphs, {
    namespace: namespace || "default",
    query,
    limit,
    offset,
  });

  let content;

  if (!tab || tab === "subgraphs") {
    if (isLoading) {
      content = <Loader className="" fullscreen />;
    } else if (error || data?.response?.code !== EnumStatusCode.OK) {
      content = (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-12 w-12" />}
          title="Could not retrieve subgraphs"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      );
    } else if (!data?.graphs) {
      content = null;
    } else {
      content = (
        <SubgraphsTable
          subgraphs={data.graphs}
          totalCount={data.count}
          tab="subgraphs"
        />
      );
    }
  } else if (tab === "featureSubgraphs") {
    if (fsLoading) {
      content = <Loader className="" fullscreen />;
    } else if (
      fsError ||
      featureSubgraphsData?.response?.code !== EnumStatusCode.OK
    ) {
      content = (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-12 w-12" />}
          title="Could not retrieve feature subgraphs"
          description={
            featureSubgraphsData?.response?.details ||
            fsError?.message ||
            "Please try again"
          }
          actions={
            <Button onClick={() => refetchFeatureSubgraphs()}>Retry</Button>
          }
        />
      );
    } else if (!featureSubgraphsData?.featureSubgraphs) {
      content = null;
    } else {
      content = (
        <SubgraphsTable
          subgraphs={featureSubgraphsData.featureSubgraphs}
          totalCount={featureSubgraphsData.count}
          tab="featureSubgraphs"
        />
      );
    }
  } else {
    content = null;
  }

  return (
    <div className="flex h-full flex-col">
      <SubgraphPageTabs />
      <div className="relative mb-4 mt-8">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Search by ID or Name"
          className="pl-8 pr-10"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            applyParams({ search: e.target.value });
          }}
        />
        {search && (
          <Button
            variant="ghost"
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={() => {
              setSearch("");
              applyParams({ search: null });
            }}
          >
            <Cross1Icon />
          </Button>
        )}
      </div>
      {content}
    </div>
  );
};

SubgraphsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Subgraphs",
    "An overview of all subgraphs",
    undefined,
    undefined,
    [<WorkspaceSelector key="0" />],
  );
};

export default SubgraphsDashboardPage;
