import { parseAsString, useQueryState, useQueryStates } from 'nuqs';
import { EmptyState } from '@/components/empty-state';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { SubgraphPageTabs, SubgraphsTable } from '@/components/subgraphs-table';
import { Button } from '@/components/ui/button';
import { ClearableInput } from '@/components/ui/clearable-input';
import { Loader } from '@/components/ui/loader';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery } from '@connectrpc/connect-query';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getFeatureSubgraphs,
  getSubgraphs,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { pageParam, usePaginationParams } from '@/hooks/use-pagination-params';

import { useDebounce } from 'use-debounce';
import { WorkspaceSelector } from '@/components/dashboard/workspace-selector';
import { useWorkspace } from '@/hooks/use-workspace';

const SubgraphsDashboardPage: NextPageWithLayout = () => {
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const [tab] = useQueryState('tab');

  const { pageSize: limit, offset } = usePaginationParams();

  const [{ search }, setSearch] = useQueryStates({ search: parseAsString.withDefault(''), page: pageParam });
  const [query] = useDebounce(search, 500);

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
    namespace: namespace || 'default',
    query,
    limit,
    offset,
  });

  let content;

  if (!tab || tab === 'subgraphs') {
    if (isLoading) {
      content = <Loader className="" fullscreen />;
    } else if (error || data?.response?.code !== EnumStatusCode.OK) {
      content = (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-12 w-12" />}
          title="Could not retrieve subgraphs"
          description={data?.response?.details || error?.message || 'Please try again'}
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      );
    } else if (!data?.graphs) {
      content = null;
    } else {
      content = <SubgraphsTable subgraphs={data.graphs} totalCount={data.count} tab="subgraphs" />;
    }
  } else if (tab === 'featureSubgraphs') {
    if (fsLoading) {
      content = <Loader className="" fullscreen />;
    } else if (fsError || featureSubgraphsData?.response?.code !== EnumStatusCode.OK) {
      content = (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-12 w-12" />}
          title="Could not retrieve feature subgraphs"
          description={featureSubgraphsData?.response?.details || fsError?.message || 'Please try again'}
          actions={<Button onClick={() => refetchFeatureSubgraphs()}>Retry</Button>}
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
      <ClearableInput
        icon={<MagnifyingGlassIcon />}
        containerClassName="mb-4 mt-8"
        placeholder="Search by ID or Name"
        clearLabel="Clear search"
        value={search}
        onChange={(e) => setSearch({ search: e.target.value, page: null })}
        onClear={search ? () => setSearch({ search: null, page: null }) : undefined}
      />
      {content}
    </div>
  );
};

SubgraphsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(page, 'Subgraphs', 'An overview of all subgraphs', undefined, undefined, [
    <WorkspaceSelector key="0" />,
  ]);
};

export default SubgraphsDashboardPage;
