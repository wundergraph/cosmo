import { parseAsString, useQueryState } from 'nuqs';
import { EmptyState } from '@/components/empty-state';
import { FeatureFlagsTable } from '@/components/feature-flags-table';
import { GraphContext, GraphPageLayout, getGraphLayout } from '@/components/layout/graph-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader } from '@/components/ui/loader';
import { NextPageWithLayout } from '@/lib/page';
import { useQuery } from '@connectrpc/connect-query';
import { Cross1Icon, ExclamationTriangleIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getFeatureFlagsByFederatedGraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';

import { usePaginationParams } from '@/hooks/use-pagination-params';
import { useContext } from 'react';
import { useDebounce } from 'use-debounce';
import { useWorkspace } from '@/hooks/use-workspace';

const FeatureFlagsPage: NextPageWithLayout = () => {
  const graphData = useContext(GraphContext);

  const {
    namespace: { name: namespace },
  } = useWorkspace();

  const { pageSize: limit, offset } = usePaginationParams();

  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [query] = useDebounce(search, 500);

  const { data, isLoading, error, refetch } = useQuery(
    getFeatureFlagsByFederatedGraph,
    {
      federatedGraphName: graphData?.graph?.name,
      namespace,
      query,
      limit,
      offset,
    },
    {
      enabled: !!graphData,
    },
  );

  if (!graphData) return null;

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
    const filteredFeatureFlags = data.featureFlags.slice(offset, limit + offset);
    content = (
      <FeatureFlagsTable featureFlags={filteredFeatureFlags} graph={graphData.graph} totalCount={data.totalCount} />
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
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <Button
            variant="ghost"
            className="absolute bottom-0 right-0 top-0 my-auto rounded-l-none"
            onClick={() => setSearch(null)}
          >
            <Cross1Icon />
          </Button>
        )}
      </div>
      {content}
    </div>
  );
};

FeatureFlagsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout title="Feature Flags" subtitle="An overview of all feature flags">
      {page}
    </GraphPageLayout>,
    { title: 'Feature Flags' },
  );

export default FeatureFlagsPage;
