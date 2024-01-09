import BarList from "@/components/analytics/barlist";
import { ChartTooltip } from "@/components/analytics/charts";
import { createFilterState } from "@/components/analytics/constructAnalyticsTableQueryState";
import { DeltaBadge } from "@/components/analytics/delta-badge";
import {
  AnalyticsFilter,
  AnalyticsFilters,
  AnalyticsSelectedFilters,
} from "@/components/analytics/filters";
import { optionConstructor } from "@/components/analytics/getDataTableFilters";
import { RefreshInterval } from "@/components/analytics/refresh-interval";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useRange } from "@/components/analytics/use-range";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { Spacer } from "@/components/ui/spacer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import useWindowSize from "@/hooks/use-window-size";
import {
  formatDurationMetric,
  formatMetric,
  formatPercentMetric,
} from "@/lib/format-metric";
import { useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { UpdateIcon } from "@radix-ui/react-icons";
import {
  keepPreviousData,
  useIsFetching,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getGraphMetrics,
  getMetricsErrorRate,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  AnalyticsViewResultFilter,
  MetricsDashboardMetric,
  MetricsTopItem,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { differenceInHours, formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useCallback, useContext, useId } from "react";
import {
  Area,
  AreaChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export type OperationAnalytics = {
  name: string;
  content: string;
  operationType: number;
};

const getInfoTip = (range?: number) => {
  switch (range) {
    case 72:
      return "last 3 day";
    case 168:
      return "last 1 week";
    case 720:
      return "last 1 month";
    case 24:
      return "last 1 day";
    default:
      return "selected period";
  }
};

const useSelectedFilters = () => {
  const router = useRouter();

  const selectedFilters = React.useMemo(() => {
    try {
      return JSON.parse(router.query.filterState?.toString() ?? "[]");
    } catch {
      return [];
    }
  }, [router.query.filterState]);

  return selectedFilters as { id: string; value: string[] }[];
};

const useMetricsFilters = (filters: AnalyticsViewResultFilter[]) => {
  const router = useRouter();

  const applyNewParams = useCallback(
    (newParams: Record<string, string | null>, unset?: string[]) => {
      const q = Object.fromEntries(
        Object.entries(router.query).filter(([key]) => !unset?.includes(key)),
      );
      router.push({
        query: {
          ...q,
          ...newParams,
        },
      });
    },
    [router],
  );

  const selectedFilters = useSelectedFilters();

  const filtersList = (filters ?? []).map((filter) => {
    return {
      ...filter,
      id: filter.columnName,
      onSelect: (value) => {
        const newSelected = [...selectedFilters];

        const index = newSelected.findIndex((f) => f.id === filter.columnName);

        if (!value || value.length === 0) {
          newSelected.splice(index, 1);
        } else if (newSelected[index]) {
          newSelected[index].value = value;
        } else {
          newSelected.push({
            id: filter.columnName,
            value: value ?? [],
          });
        }

        let stringifiedFilters;
        try {
          stringifiedFilters = JSON.stringify(newSelected);
        } catch {
          stringifiedFilters = "[]";
        }
        applyNewParams({
          filterState: stringifiedFilters,
        });
      },
      selectedOptions:
        selectedFilters.find(
          (f: { id: string; value: string[] }) => f.id === filter.columnName,
        )?.value ?? [],
      options: filter.options.map((each) =>
        optionConstructor({
          label: each.label || "-",
          operator: each.operator as unknown as string,
          value: each.value as unknown as string,
        }),
      ),
    } as AnalyticsFilter;
  });

  const resetFilters = () => {
    applyNewParams({
      filterState: null,
    });
  };

  return {
    filtersList,
    selectedFilters,
    resetFilters,
  };
};

interface MetricsFiltersProps {
  filters: AnalyticsViewResultFilter[];
}

const MetricsFilters: React.FC<MetricsFiltersProps> = (props) => {
  const { filters } = props;

  const { filtersList } = useMetricsFilters(filters);

  return <AnalyticsFilters filters={filtersList} />;
};

const AnalyticsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

  let { data, isLoading, error, refetch } = useQuery({
    ...getGraphMetrics.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      range,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
      filters,
    }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: refreshInterval,
  });

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
        <RequestMetricsCard data={data?.requests} />
        <LatencyMetricsCard data={data?.latency} />
        <ErrorMetricsCard data={data?.errors} />
      </div>

      <ErrorRateOverTimeCard />
    </div>
  );
};

const getDeltaType = (
  value: number,
  { invert, neutral }: { invert?: boolean; neutral?: boolean },
) => {
  if (value === 0) {
    return "neutral";
  }

  const d = value > 0 ? "increase" : "decrease";

  if (neutral) {
    return `${d}-neutral`;
  } else if (value > 0 && !invert) {
    return "increase-positive";
  } else if (value > 0 && invert) {
    return "increase-negative";
  } else if (value < 0 && !invert) {
    return "decrease-negative";
  } else if (value < 0 && invert) {
    return "decrease-positive";
  }

  return "neutral";
};

const Change = ({
  value,
  previousValue,
  invert,
  neutral,
  deltaType,
}: {
  value?: number;
  previousValue?: number;
  invert?: boolean;
  neutral?: boolean;
  deltaType?: string;
}) => {
  if (typeof value === "undefined" || typeof previousValue === "undefined") {
    return null;
  }

  let delta = 0;
  if (previousValue !== 0) {
    delta = ((value || 0) / (previousValue || 1)) * 100 - 100;
  } else if (value !== 0 && previousValue === 0) {
    // If previous range is zero, we assume 100% change.
    delta = 100;
  }

  return (
    <DeltaBadge
      type={deltaType || (getDeltaType(delta, { invert, neutral }) as any)}
      value={formatPercentMetric(delta)}
    />
  );
};

const TopList: React.FC<{
  title: string;
  items: MetricsTopItem[];
  formatter: (value: number) => string;
  queryParams?: Record<string, string | number>;
}> = ({ title, items, formatter, queryParams = {} }) => {
  const router = useRouter();

  const range = router.query.range;
  const dateRange = router.query.dateRange;

  const hasPersisted = items.some((i) => i.isPersisted);

  return (
    <CardContent className="pt-6">
      <div className="mb-2 flex space-x-2 text-sm">
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <h5 className="group text-sm font-medium">
              <Link
                href={{
                  pathname: `${router.pathname}/traces`,
                  query: {
                    organizationSlug: router.query.organizationSlug,
                    slug: router.query.slug,
                    filterState: router.query.filterState || "[]",
                    range,
                    dateRange,
                    ...queryParams,
                  },
                }}
                className="inline-flex rounded-md px-2 py-1 hover:bg-muted"
              >
                {title}
                <ChevronRightIcon className="h4 ml-1 w-4 transition-all group-hover:ml-2" />
              </Link>
            </h5>
          </TooltipTrigger>
          <TooltipContent>View all operations</TooltipContent>
        </Tooltip>
      </div>
      <BarList
        data={items.map((row) => ({
          ...row,
          key: row.hash + row.name,
          value: Number.parseFloat(row.value ?? "0"),
          name: (
            <div className="flex items-center">
              <span className="flex w-16 shrink-0">
                {row.hash.slice(0, 6) || "-------"}
              </span>
              <span className="truncate">
                {row.name === "" ? "-" : row.name}
              </span>
              {row.isPersisted && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="ml-2">
                      <div className="flex h-3.5 items-center justify-center rounded bg-success/40 px-1 text-[10px] font-bold text-primary-foreground">
                        P
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Persisted Query</TooltipContent>
                </Tooltip>
              )}
            </div>
          ),
          href: {
            pathname: `${router.pathname}/traces`,
            query: {
              organizationSlug: router.query.organizationSlug,
              slug: router.query.slug,
              filterState: createFilterState({
                operationName: row.name,
                operationHash: row.hash,
              }),
              range,
              dateRange,
            },
          },
        }))}
        valueFormatter={formatter}
        rowHeight={4}
        rowClassName="bg-muted text-muted-foreground hover:text-foreground"
      />
    </CardContent>
  );
};

const RequestMetricsCard = (props: { data?: MetricsDashboardMetric }) => {
  const range = useRange();
  const { data } = props;

  const top = data?.top ?? [];

  const value = Number.parseFloat(data?.value || "0");
  const previousValue = Number.parseFloat(data?.previousValue || "0");

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

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start pb-2">
        <div className="flex-1">
          <div className="flex space-x-2 text-sm">
            <h4>Request Rate</h4>
            <InfoTooltip>RPM in {getInfoTip(range)}</InfoTooltip>
          </div>

          <p className="text-xl font-semibold">{formatter(value)}</p>

          <p className="text-sm text-muted-foreground">
            vs {formatter(previousValue)} last period
          </p>
        </div>

        <Change value={value} previousValue={previousValue} neutral />
      </CardHeader>
      <CardContent className="border-b pb-2">
        <Sparkline
          series={data?.series ?? []}
          valueFormatter={formatter}
          timeRange={range}
        />
      </CardContent>
      <TopList
        title="Highest RPM"
        items={top}
        formatter={formatter}
        queryParams={top.length > 1 ? { group: "OperationName" } : {}}
      />
    </Card>
  );
};

const LatencyMetricsCard = (props: { data?: MetricsDashboardMetric }) => {
  const range = useRange();
  const { data } = props;

  const top = data?.top ?? [];

  const value = Number.parseInt(data?.value || "0");
  const previousValue = Number.parseInt(data?.previousValue || "0");

  const formatter = (value: number) => {
    return formatDurationMetric(value, {
      maximumFractionDigits: 3,
    });
  };

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start pb-2">
        <div className="flex-1">
          <div className="flex space-x-2 text-sm">
            <h4>P95 Latency</h4>
            <InfoTooltip>P95 latency in {getInfoTip(range)}</InfoTooltip>
          </div>
          <p className="text-xl font-semibold">{formatter(value)}</p>

          <p className="text-sm text-muted-foreground">
            vs {formatter(previousValue)} last period
          </p>
        </div>

        <Change value={value} previousValue={previousValue} invert />
      </CardHeader>
      <CardContent className="border-b pb-2">
        <Sparkline
          series={data?.series ?? []}
          valueFormatter={formatter}
          timeRange={range}
        />
      </CardContent>
      <TopList
        title="Highest latency"
        items={top}
        formatter={formatter}
        queryParams={
          top.length > 1
            ? { group: "OperationName", sort: "p95", sortDir: "desc" }
            : {}
        }
      />
    </Card>
  );
};

const ErrorMetricsCard = (props: { data?: MetricsDashboardMetric }) => {
  const range = useRange();
  const { data } = props;

  const top = data?.top ?? [];

  const value = Number.parseFloat(data?.value || "0");
  const previousValue = Number.parseFloat(data?.previousValue || "0");

  const formatter = (value: number) => formatPercentMetric(value);

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start pb-2">
        <div className="flex-1">
          <div className="flex space-x-2 text-sm">
            <h4>Error Percentage</h4>
            <InfoTooltip>Error percentage in {getInfoTip(range)}</InfoTooltip>
          </div>
          <p className="text-xl font-semibold">{formatter(value)}</p>
          <p className="text-sm text-muted-foreground">
            vs {formatter(previousValue)} last period
          </p>
        </div>

        <Change value={value} previousValue={previousValue} invert />
      </CardHeader>
      <CardContent className="border-b pb-2">
        <ErrorPercentChart
          series={data?.series ?? []}
          valueFormatter={formatter}
          timeRange={range}
        />
      </CardContent>
      <TopList
        title="Highest error percentage"
        items={top}
        formatter={formatter}
        queryParams={
          top.length > 1
            ? { group: "OperationName", sort: "errorsWithRate" }
            : {}
        }
      />
    </Card>
  );
};

interface SparklineProps {
  series: any[];
  timeRange: number;
  className?: string;
  valueFormatter?: (value: any) => any;
}

const Sparkline: React.FC<SparklineProps> = (props) => {
  const { timeRange = 24, valueFormatter } = props;
  const id = useId();

  const { data, ticks, domain, timeFormatter } = useChartData(
    timeRange,
    props.series,
  );

  const strokeColor = "hsl(var(--chart-primary))";

  return (
    <div className={cn("-mx-6 h-20", props.className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 6, bottom: 8, left: 6 }}
        >
          <defs>
            <linearGradient
              id={`${id}-gradient-previous`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor={"hsl(var(--chart-primary-gradient))"}
              />
              <stop offset="95%" stopColor={"hsl(var(--background))"} />
            </linearGradient>
            <linearGradient id={`${id}-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={"hsl(var(--chart-primary-gradient))"}
              />
              <stop offset="100%" stopColor={"hsl(var(--background))"} />
            </linearGradient>
          </defs>
          <Area
            name="Previous"
            type="monotone"
            dataKey="previousValue"
            activeDot={false}
            animationDuration={300}
            stroke={strokeColor}
            fill={`url(#${id}-gradient-previous)`}
            dot={false}
            strokeWidth={1.5}
            opacity="0.4"
            strokeDasharray="4 2"
          />
          <Area
            name="Current"
            type="monotone"
            dataKey="value"
            animationDuration={300}
            stroke={strokeColor}
            fill={`url(#${id}-gradient)`}
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
            axisLine={false}
            hide
          />

          <ChartTooltip formatter={valueFormatter} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const ErrorPercentChart: React.FC<SparklineProps> = (props) => {
  const { timeRange = 24, valueFormatter } = props;
  const id = useId();
  const { data, ticks, domain, timeFormatter } = useChartData(
    timeRange,
    props.series,
  );

  return (
    <div className={cn("-mx-6 h-20", props.className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 6, bottom: 8, left: 6 }}
        >
          <defs>
            <linearGradient id={`${id}-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={"hsl(var(--muted-foreground))"} />
              <stop offset="95%" stopColor={"hsl(var(--muted))"} />
            </linearGradient>
          </defs>
          <Area
            name="Previous"
            type="monotone"
            dataKey="previousValue"
            activeDot={false}
            animationDuration={300}
            stroke={"hsl(215.4 16.3% 46.9%)"}
            fill={`url(#${id}-gradient)`}
            fillOpacity="0.3"
            dot={false}
            strokeWidth={1.5}
            opacity="0.4"
            strokeDasharray="4 2"
          />
          <Area
            name="Current"
            type="monotone"
            dataKey="value"
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
            axisLine={false}
            hide
          />

          <XAxis dataKey="timestamp" type="number" axisLine={false} hide />

          <ChartTooltip formatter={valueFormatter} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const ErrorRateOverTimeCard = () => {
  const id = useId();
  const graphContext = useContext(GraphContext);

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
  } = useQuery({
    ...getMetricsErrorRate.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      range,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
      filters,
    }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: refreshInterval,
  });

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
  const graphContext = useContext(GraphContext);
  const client = useQueryClient();

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

  const metrics = getGraphMetrics.useQuery({
    federatedGraphName: graphContext?.graph?.name,
    range,
  });

  const errorRate = getMetricsErrorRate.useQuery({
    federatedGraphName: graphContext?.graph?.name,
    range,
  });

  const isFetching = useIsFetching();

  let { data } = useQuery({
    ...getGraphMetrics.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
      range,
      filters,
    }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const { filtersList, selectedFilters, resetFilters } = useMetricsFilters(
    data?.filters ?? [],
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

          <MetricsFilters filters={data?.filters ?? []} />
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
              queryKey: metrics.queryKey,
            });
            client.invalidateQueries({
              queryKey: errorRate.queryKey,
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
