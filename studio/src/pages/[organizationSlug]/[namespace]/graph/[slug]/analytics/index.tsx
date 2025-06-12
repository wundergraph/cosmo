import { AnalyticsSelectedFilters } from "@/components/analytics/filters";
import {
  ErrorMetricsCard,
  ErrorRateOverTimeCard,
  LatencyDistributionCard,
  LatencyMetricsCard,
  MetricsFilters,
  RequestMetricsCard,
  useMetricsFilters,
} from "@/components/analytics/metrics";
import { RefreshInterval } from "@/components/analytics/refresh-interval";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Spacer } from "@/components/ui/spacer";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { NextPageWithLayout } from "@/lib/page";
import { createConnectQueryKey, useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { UpdateIcon } from "@radix-ui/react-icons";
import {
  keepPreviousData,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getGraphMetrics,
  getMetricsErrorRate,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  AnalyticsViewResultFilter
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatISO } from "date-fns";
import { useContext } from "react";

export type OperationAnalytics = {
  name: string;
  content: string;
  operationType: number;
};

const OverviewToolbar = ({
  filters,
}: {
  filters?: AnalyticsViewResultFilter[];
}) => {
  const graphContext = useContext(GraphContext);
  const client = useQueryClient();

  const { range, dateRange, refreshInterval } = useAnalyticsQueryState();

  const isFetching = useIsFetching();

  const { filtersList, selectedFilters, resetFilters } = useMetricsFilters(
    filters ?? [],
  );

  const applyParams = useApplyParams();

  const onDateRangeChange: DateRangePickerChangeHandler = ({
    range,
    dateRange,
  }) => {
    if (range) {
      applyParams({
        range: range.toString(),
        dateRange: null,
      });
    } else if (dateRange) {
      const stringifiedDateRange = JSON.stringify({
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end ?? dateRange.start),
      });

      applyParams({
        range: null,
        dateRange: stringifiedDateRange,
      });
    }
  };

  const onRefreshIntervalChange = (value?: number) => {
    applyParams({
      refreshInterval: value ? value.toString() : null,
    });
  };

  const analyticsRetention = useFeatureLimit("analytics-retention", 7);

  return (
    <div className="flex flex-col gap-2 space-y-2">
      <div className="flex gap-2">
        <div className="flex flex-wrap gap-2">
          <DatePickerWithRange
            range={range}
            dateRange={dateRange}
            onChange={onDateRangeChange}
            calendarDaysLimit={analyticsRetention}
          />

          <MetricsFilters filters={filters ?? []} />
          <AnalyticsSelectedFilters
            filters={filtersList}
            selectedFilters={selectedFilters}
            onReset={() => resetFilters()}
          />
        </div>

        <Spacer />
        <Button
          isLoading={!!isFetching}
          onClick={() => {
            client.invalidateQueries({
              queryKey: createConnectQueryKey(getGraphMetrics, {
                namespace: graphContext?.graph?.namespace,
                federatedGraphName: graphContext?.graph?.name,
                range,
              }),
            });
            client.invalidateQueries({
              queryKey: createConnectQueryKey(getMetricsErrorRate, {
                namespace: graphContext?.graph?.namespace,
                federatedGraphName: graphContext?.graph?.name,
                range,
              }),
            });
          }}
          variant="outline"
          size="icon"
        >
          <UpdateIcon />
        </Button>
        <RefreshInterval
          value={refreshInterval}
          onChange={onRefreshIntervalChange}
        />
      </div>
    </div>
  );
};

const AnalyticsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);
  const syncId = `${graphContext?.graph?.namespace}-${graphContext?.graph?.name}`;

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

  let { data, isLoading, error, refetch } = useQuery(
    getGraphMetrics,
    {
      namespace: graphContext?.graph?.namespace,
      federatedGraphName: graphContext?.graph?.name,
      range,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
      filters,
    },
    {
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      refetchInterval: refreshInterval,
    },
  );

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
  } else if (isLoading) {
    return <Loader fullscreen />;
  }

  return (
    <div className="w-full space-y-4">
      <OverviewToolbar filters={data?.filters} />
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3">
        <RequestMetricsCard data={data?.requests} syncId={syncId} />
        <LatencyMetricsCard data={data?.latency} syncId={syncId} />
        <ErrorMetricsCard data={data?.errors} syncId={syncId} />
      </div>

      <ErrorRateOverTimeCard syncId={syncId} />
      <LatencyDistributionCard series={data?.latency?.series ?? []} syncId={syncId} />
    </div>
  );
};

AnalyticsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Analytics"
      subtitle="Comprehensive view into Federated GraphQL Performance"
      toolbar={<AnalyticsToolbar tab="overview" />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Analytics",
    },
  );
export default AnalyticsPage;
