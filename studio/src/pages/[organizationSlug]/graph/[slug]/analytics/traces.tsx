import { AnalyticsDataTable } from "@/components/analytics/data-table";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { EmptyState } from "@/components/empty-state";
import { getGraphLayout, GraphContext } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Button } from "@/components/ui/button";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getAnalyticsView } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatISO } from "date-fns";
import { useContext } from "react";

export type OperationAnalytics = {
  name: string;
  content: string;
  operationType: number;
};

// For the network call we read purely from the query with useAnalyticsQueryState
// The data table should only set url params and not the state for filters and pagination
// The useSyncTableWithQuery is responsible to read from the query and set local state
// This way we avoid race conditions and repeated network calls

const TracesPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

  const {
    name,
    filters,
    pagination,
    range,
    dateRange,
    page,
    refreshInterval,
    sort,
  } = useAnalyticsQueryState();

  let { data, isFetching, isLoading, error, refetch } = useQuery({
    ...getAnalyticsView.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      name,
      config: {
        filters,
        range,
        dateRange: {
          start: formatISO(dateRange.start),
          end: formatISO(dateRange.end),
        },
        pagination,
        sort,
      },
    }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: refreshInterval,
  });

  const rowData =
    data?.view?.rows.map((each) => {
      const entries = Object.entries(each.value);
      const row: {
        [key: string]: (typeof entries)[number]["1"]["kind"]["value"];
      } = {};

      for (const [key, valueObject] of entries) {
        row[key] = valueObject.kind.value;
      }
      return row;
    }) ?? [];

  if (!isLoading && (error || data?.response?.code !== EnumStatusCode.OK)) {
    return (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve analytics data"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <AnalyticsDataTable
        data={rowData}
        columnsList={data?.view?.columns ?? []}
        filters={data?.view?.filters ?? []}
        isFetching={isFetching}
        isLoading={isLoading}
        pageCount={data?.view?.pages ?? Number(page) + 1}
        refresh={() => refetch()}
      />
    </div>
  );
};

TracesPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Analytics">
      <TitleLayout
        title="Analytics"
        subtitle="Comprehensive view into Federated GraphQL Performance"
        toolbar={<AnalyticsToolbar tab="traces" />}
      >
        {page}
      </TitleLayout>
    </PageHeader>,
  );

export default TracesPage;
