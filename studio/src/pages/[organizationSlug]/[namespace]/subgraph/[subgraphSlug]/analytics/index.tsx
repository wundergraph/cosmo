import { ChartTooltip } from "@/components/analytics/charts";
import { AnalyticsSelectedFilters } from "@/components/analytics/filters";
import {
  ErrorMetricsCard,
  LatencyMetricsCard,
  LatencyDistributionCard,
  MetricsFilters,
  RequestMetricsCard,
  getInfoTip,
  useMetricsFilters,
} from "@/components/analytics/metrics";
import { RefreshInterval } from "@/components/analytics/refresh-interval";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  SubgraphPageLayout,
  getSubgraphLayout,
} from "@/components/layout/subgraph-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { Spacer } from "@/components/ui/spacer";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useSubgraph } from "@/hooks/use-subgraph";
import useWindowSize from "@/hooks/use-window-size";
import { formatMetric } from "@/lib/format-metric";
import { useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon, UpdateIcon } from "@radix-ui/react-icons";
import {
  keepPreviousData,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useQuery,
  useMutation,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getSubgraphMetrics,
  getSubgraphMetricsErrorRate,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { differenceInHours, formatISO, sub } from "date-fns";
import { useRouter } from "next/router";
import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const SubgraphErrorRateOverTimeCard = ({ syncId }: { syncId?: string }) => {
  const id = useId();
  const subgraph = useSubgraph();

  const formatter = (value: number) => {
    if (value < 1) {
      return (
        formatMetric(value, {
          maximumFractionDigits: 3,
        }) + " RPM"
      );
    }

    return (
      formatMetric(value, {
        maximumFractionDigits: 0,
      }) + " RPM"
    );
  };

  const { isMobile } = useWindowSize();

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

  let {
    data: responseData,
    isLoading,
    error,
    refetch,
  } = useQuery(
    getSubgraphMetricsErrorRate,
    {
      subgraphName: subgraph?.subgraph?.name,
      namespace: subgraph?.subgraph?.namespace,
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

  const { data, ticks, domain, timeFormatter } = useChartData(
    differenceInHours(dateRange.end, dateRange.start) ?? 24,
    responseData?.series ?? [],
  );

  let content;
  if (
    !isLoading &&
    (error || responseData?.response?.code !== EnumStatusCode.OK)
  ) {
    content = (
      <EmptyState
        className="h-auto"
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve analytics data"
        description={
          responseData?.response?.details ||
          error?.message ||
          "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else if (isLoading) {
    content = <Loader fullscreen />;
  } else {
    content = (
      <ResponsiveContainer width="99%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
          syncId={syncId}
        >
          <defs>
            <linearGradient id={`${id}-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={"hsl(var(--muted-foreground))"} />
              <stop offset="95%" stopColor={"hsl(var(--muted))"} />
            </linearGradient>
          </defs>
          <Area
            name="Request rate"
            type="monotone"
            dataKey="requestRate"
            animationDuration={300}
            stroke="hsl(var(--muted-foreground))"
            fill={`url(#${id}-gradient)`}
            dot={false}
            strokeWidth={1.5}
            opacity="0.4"
          />
          <Area
            name="Error rate"
            type="monotone"
            dataKey="errorRate"
            animationDuration={300}
            stroke="hsl(var(--destructive))"
            fill="none"
            fillOpacity="1"
            dot={false}
            strokeWidth={1.5}
          />

          <XAxis
            dataKey="timestamp"
            domain={domain}
            ticks={ticks}
            tickFormatter={timeFormatter}
            type="number"
            interval="preserveStart"
            minTickGap={60}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "13px" }}
          />

          <YAxis
            hide={isMobile}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "13px" }}
          />

          <Legend
            verticalAlign="top"
            align="right"
            wrapperStyle={{ fontSize: "13px", marginTop: "-10px" }}
          />

          <ChartTooltip formatter={formatter} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <Card className="bg-transparent">
      <CardHeader>
        <div className="flex space-x-2">
          <CardTitle>Error rate over time</CardTitle>
          <InfoTooltip>
            Error rate per minute in {getInfoTip(range)}
          </InfoTooltip>
        </div>
      </CardHeader>

      <CardContent className="h-[240px]">{content}</CardContent>
    </Card>
  );
};

const OverviewToolbar = () => {
  const subgraph = useSubgraph();

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

  const client = useQueryClient();
  const isFetching = useIsFetching();

  let { data } = useQuery(
    getSubgraphMetrics,
    {
      subgraphName: subgraph?.subgraph?.name,
      namespace: subgraph?.subgraph?.namespace,
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

  const dataFilters = useMemo(() => {
    if (
      subgraph?.subgraph?.labels.length === 1 &&
      subgraph.subgraph.labels[0].key === "_internal"
    ) {
      return (
        data?.filters.filter((f) => f.columnName !== "federatedGraphId") ?? []
      );
    }

    return data?.filters ?? [];
  }, [data?.filters, subgraph?.subgraph?.labels]);

  const { filtersList, selectedFilters, resetFilters } =
    useMetricsFilters(dataFilters);

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

          <MetricsFilters filters={dataFilters} />
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
              queryKey: createConnectQueryKey(getSubgraphMetrics, {
                subgraphName: subgraph?.subgraph?.name,
                namespace: subgraph?.subgraph?.namespace,
                range,
              }),
            });
            client.invalidateQueries({
              queryKey: createConnectQueryKey(getSubgraphMetricsErrorRate, {
                subgraphName: subgraph?.subgraph?.name,
                namespace: subgraph?.subgraph?.namespace,
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

const SubgraphAnalyticsPage: NextPageWithLayout = () => {
  const subgraph = useSubgraph();
  const syncId = `${subgraph?.subgraph?.namespace}-${subgraph?.subgraph?.name}`;

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

  let { data, isLoading, error, refetch } = useQuery(
    getSubgraphMetrics,
    {
      subgraphName: subgraph?.subgraph?.name,
      namespace: subgraph?.subgraph?.namespace,
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
      <OverviewToolbar />
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3">
        <RequestMetricsCard data={data?.requests} isSubgraphAnalytics={true} syncId={syncId} />
        <LatencyMetricsCard data={data?.latency} isSubgraphAnalytics={true} syncId={syncId} />
        <ErrorMetricsCard data={data?.errors} isSubgraphAnalytics={true} syncId={syncId} />
      </div>

      <SubgraphErrorRateOverTimeCard syncId={syncId} />
      <LatencyDistributionCard series={data?.latency?.series ?? []} syncId={syncId} />
    </div>
  );
};

SubgraphAnalyticsPage.getLayout = (page) =>
  getSubgraphLayout(
    <SubgraphPageLayout
      title="Analytics"
      subtitle="Comprehensive view into Subgraph Performance"
    >
      {page}
    </SubgraphPageLayout>,
    {
      title: "Analytics",
    },
  );
export default SubgraphAnalyticsPage;
