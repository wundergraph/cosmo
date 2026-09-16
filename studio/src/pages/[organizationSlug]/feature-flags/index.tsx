import { parseAsString, useQueryStates } from 'nuqs';
import { EmptyState } from '@/components/empty-state';
import { FeatureFlagsTable } from '@/components/feature-flags-table';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader } from '@/components/ui/loader';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery } from '@connectrpc/connect-query';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Cross1Icon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getFeatureFlags } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';

import { pageParam, usePaginationParams } from '@/hooks/use-pagination-params';

import { useDebounce } from 'use-debounce';
import { WorkspaceSelector } from '@/components/dashboard/workspace-selector';
import { useWorkspace } from '@/hooks/use-workspace';

const FeatureFlagsDashboardPage: NextPageWithLayout = () => {
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  const { pageSize: limit, offset } = usePaginationParams();

  const [{ search }, setSearch] = useQueryStates({ search: parseAsString.withDefault(''), page: pageParam });
  const [query] = useDebounce(search, 500);

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
        description={data?.response?.details || error?.message || 'Please try again'}
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else if (!data?.featureFlags) {
    content = null;
  } else {
    content = <FeatureFlagsTable featureFlags={data.featureFlags} totalCount={data.totalCount} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="absolute bottom-0 left-3 top-0 my-auto" />
        <Input
          placeholder="Search by name"
          className="pl-8 pr-10"
          value={search}
          onChange={(e) => setSearch({ search: e.target.value, page: null })}
        />
        {search && (
          <Button
            variant="ghost"
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={() => setSearch({ search: null, page: null })}
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
  return getDashboardLayout(page, 'Feature Flags', 'An overview of all feature flags', undefined, undefined, [
    <WorkspaceSelector key="0" />,
  ]);
};

export default FeatureFlagsDashboardPage;
