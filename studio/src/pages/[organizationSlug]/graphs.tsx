import { EmptyState } from '@/components/empty-state';
import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { NextPageWithLayout } from '@/lib/page';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { getFederatedGraphs } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { FederatedGraphsCards } from '@/components/federatedgraphs-cards';

const GraphsDashboardPage: NextPageWithLayout = () => {
  const { data, isLoading, error, refetch } = useQuery(
    getFederatedGraphs.useQuery({
      includeMetrics: true,
    })
  );

  if (isLoading) return <Loader fullscreen />;

  if (error || data.response?.code !== EnumStatusCode.OK)
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve federated graphs"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );

  return <FederatedGraphsCards graphs={data.graphs} refetch={refetch} />;
};

GraphsDashboardPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Federated Graphs",
    "View all your federated graphs"
  );
};

export default GraphsDashboardPage;
