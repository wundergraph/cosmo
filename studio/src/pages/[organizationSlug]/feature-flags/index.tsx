import { useApplyParams } from "@/components/analytics/use-apply-params";
import { EmptyState } from "@/components/empty-state";
import { FeatureFlagsTable } from "@/components/feature-flags-table";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { NextPageWithLayout } from "@/lib/page";
import { useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Cross1Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFeatureFlags } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useRouter } from "next/router";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { WorkspaceSelector } from "@/components/dashboard/workspace-selector";
import { useWorkspace } from "@/hooks/use-workspace";

const FeatureFlagsDashboardPage: NextPageWithLayout = () => {
  const { namespace: { name: namespace } } = useWorkspace();
  const router = useRouter();

  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const pageSize = Number.parseInt((router.query.pageSize as string) || "10");
  const limit = pageSize > 50 ? 50 : pageSize;
  const offset = (pageNumber - 1) * limit;

  const [search, setSearch] = useState(router.query.search as string);
  const [query] = useDebounce(search, 500);

  const applyParams = useApplyParams();

  const { data, isLoading, error, refetch } = useQuery(getFeatureFlags, {
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
        title="Could not retrieve feature flags"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else if (!data?.featureFlags) {
    content = null;
  } else {
    content = (
      <FeatureFlagsTable featureFlags={data.featureFlags} totalCount={data.totalCount} />
    );
  }

  return (
    <div className="flex h-full flex-col">
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
    </div>
  );
};

FeatureFlagsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Feature Flags",
    "An overview of all feature flags",
    undefined,
    undefined,
    [<WorkspaceSelector key="0" />],
  );
};

export default FeatureFlagsDashboardPage;
