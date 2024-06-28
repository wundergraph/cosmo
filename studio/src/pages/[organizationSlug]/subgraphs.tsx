import { useApplyParams } from "@/components/analytics/use-apply-params";
import { UserContext } from "@/components/app-provider";
import { NamespaceSelector } from "@/components/dashboard/NamespaceSelector";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { SubgraphsTable } from "@/components/subgraphs-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getSubgraphs } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useContext, useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

const SubgraphsDashboardPage: NextPageWithLayout = () => {
  const router = useRouter();
  const namespace = router.query.namespace as string;
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
    namespace,
    query,
    limit,
    offset,
  });

  let content;

  if (isLoading) {
    content = <Loader className="" fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve subgraphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else if (!data?.graphs) {
    content = null;
  } else if (tab === "subgraphs") {
    content = (
      <SubgraphsTable
        subgraphs={data.graphs.filter((g) => !g.isFeatureSubgraph)}
        totalCount={data.count}
      />
    );
  } else {
    content = (
      <SubgraphsTable
        subgraphs={data.graphs.filter((g) => g.isFeatureSubgraph)}
        totalCount={data.count}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs value={tab ?? "subgraphs"} className="flex h-full min-h-0 flex-col">
        <div className="flex flex-row pb-4">
          <TabsList>
            <TabsTrigger value="subgraphs" asChild>
              <Link href={{ query: { ...router.query, tab: "subgraphs" } }}>
                Subgraphs
              </Link>
            </TabsTrigger>
            <TabsTrigger value="featureSubgraphs" asChild>
              <Link
                href={{ query: { ...router.query, tab: "featureSubgraphs" } }}
              >
                Feature Subgraphs
              </Link>
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="relative mb-4">
          <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
          <Input
            placeholder="Search by name"
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
      </Tabs>
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
    [<NamespaceSelector key="0" />],
  );
};

export default SubgraphsDashboardPage;
