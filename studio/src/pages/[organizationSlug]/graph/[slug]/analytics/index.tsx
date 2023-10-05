import BarList from "@/components/analytics/barlist";
import {
  createFilterState,
} from "@/components/analytics/constructAnalyticsTableQueryState";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { EmptyState } from "@/components/empty-state";
import { getGraphLayout, GraphContext } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DeltaBadge } from "@/components/analytics/delta-badge";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spacer } from "@/components/ui/spacer";
import { useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getMetricsDashboard,
  getMetricsErrorRate,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { MetricsDashboardMetric } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useRouter } from "next/router";
import React, { useContext, useEffect, useId } from "react";
import {
  Area,
  AreaChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/analytics/charts";
import { InfoTooltip } from "@/components/info-tooltip";
import useWindowSize from "@/hooks/use-window-size";
import { endOfDay, formatISO, startOfDay, subHours } from "date-fns";
import { UpdateIcon } from "@radix-ui/react-icons";
import { useSessionStorage } from "@/hooks/use-session-storage";

export type OperationAnalytics = {
  name: string;
  content: string;
  operationType: number;
};

// This is now static, but at some point we can introduce a date range picker for custom ranges.
const useRange = () => {
  const router = useRouter();

  const [storedRange, setRange] = useSessionStorage('analytics.range', 24)

  const range = router.query.range ? parseInt(router.query.range?.toString()) || storedRange : storedRange;

  useEffect(() => {
    if (range !== storedRange) {
      setRange(range)
    }
  }, [range, storedRange])

  switch (range) {
    case 24:
      return 24;
    case 72:
      return 72;
    case 168:
      return 168;
    default:
      return Math.min(24, range);
  }
};

const createDateRange = (range: number) => {
  return JSON.stringify({
    start: formatISO(startOfDay(subHours(new Date(), range))),
    end: formatISO(endOfDay(new Date())),
  });
};

const getInfoTip = (range: number) => {
  switch (range) {
    case 72:
      return "3 day";
    case 168:
      return "1 week";
    case 24:
    default:
      return `${range} hour`;
  }
};

const AnalyticsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

  const range = useRange();

  let { data, isLoading, error, refetch } = useQuery({
    ...getMetricsDashboard.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      range,
    }),
    keepPreviousData: true,
    refetchOnWindowFocus: false,
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
      <div className="flex flex-col lg:grid gap-4 lg:grid-cols-3">
        <RequestMetricsCard data={data?.requests} />
        <LatencyMetricsCard data={data?.latency} />
        <ErrorMetricsCard data={data?.errors} />
      </div>

      <div className="flex flex-col items-stretch">
        <ErrorRateOverTimeCard />
      </div>
    </div>
  );
};

const getDeltaType = (
  value: number,
  { invert, neutral }: { invert?: boolean; neutral?: boolean }
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
      value={`${delta < 1 ? delta.toFixed(2) : delta.toFixed(0)}%`}
    />
  );
};

const RequestMetricsCard = (props: { data?: MetricsDashboardMetric }) => {
  const router = useRouter();
  const range = useRange();
  const { data } = props;

  const top = data?.top ?? [];

  const value = Number.parseFloat(data?.value || "0");
  const previousValue = Number.parseFloat(data?.previousValue || "0");

  const formatter = (value: number) => {
    if (value < 1) {
      return (
        Intl.NumberFormat("us", {
          maximumFractionDigits: 3,
        })
          .format(value)
          .toString() + " RPM"
      );
    }

    return (
      Intl.NumberFormat("us", {
        maximumFractionDigits: 0,
      })
        .format(value)
        .toString() + " RPM"
    );
  };

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start pb-2">
        <div className="flex-1">
          <div className="flex space-x-2 text-sm">
            <h4>Request Rate</h4>
            <InfoTooltip>RPM in last {getInfoTip(range)}</InfoTooltip>
          </div>

          <p className="text-xl font-semibold">{formatter(value)}</p>

          <p className="text-sm text-muted-foreground">vs {formatter(previousValue)} last period</p>
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
      <CardContent className="pt-6">
        <div className="mb-2 flex space-x-2 px-2 text-sm">
          <h5 className="text-sm font-medium">Highest RPM</h5>
        </div>
        <BarList
          data={top.map((row) => ({
            ...row,
            value: Number.parseFloat(row.value ?? "0"),
            name: row.name === "" ? "unknown" : row.name,
            href: {
              pathname: `${router.pathname}/traces`,
              query: {
                organizationSlug: router.query.organizationSlug,
                slug: router.query.slug,
                filterState: createFilterState({
                  operationName: row.name === "" ? "unknown" : row.name,
                }),
                dateRange: createDateRange(range),
              },
            },
          }))}
          valueFormatter={formatter}
          rowHeight={4}
          rowClassName="bg-muted text-muted-foreground hover:text-foreground"
        />
      </CardContent>
    </Card>
  );
};

const LatencyMetricsCard = (props: { data?: MetricsDashboardMetric }) => {
  const router = useRouter();
  const range = useRange();
  const { data } = props;

  const top = data?.top ?? [];

  const value = Number.parseInt(data?.value || "0");
  const previousValue = Number.parseInt(data?.previousValue || "0");

  const formatter = (value: number) => {
    if (value < 1) {
      return (
        Intl.NumberFormat("us", {
          maximumFractionDigits: 3,
        })
          .format(value)
          .toString() + " ms"
      );
    }

    return (
      Intl.NumberFormat("us", {
        maximumFractionDigits: 0,
      })
        .format(value)
        .toString() + " ms"
    );
  };

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start pb-2">
        <div className="flex-1">
          <div className="flex space-x-2 text-sm">
            <h4>P95 Latency</h4>
            <InfoTooltip>P95 latency in last {getInfoTip(range)}</InfoTooltip>
          </div>
          <p className="text-xl font-semibold">{formatter(value)}</p>

          <p className="text-sm text-muted-foreground">vs {formatter(previousValue)} last period</p>
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
      <CardContent className="pt-6">
        <div className="mb-2 flex space-x-2 px-2 text-sm">
          <h5 className="text-sm font-medium">Highest latency</h5>
        </div>
        <BarList
          data={top.map((row) => ({
            ...row,
            name: row.name === "" ? "unknown" : row.name,
            value: Number.parseFloat(row.value ?? "0"),
            href: {
              pathname: `${router.pathname}/traces`,
              query: {
                organizationSlug: router.query.organizationSlug,
                slug: router.query.slug,
                filterState: createFilterState({
                  operationName: row.name === "" ? "unknown" : row.name,
                }),
                dateRange: createDateRange(range),
              },
            },
          }))}
          valueFormatter={formatter}
          rowHeight={4}
          rowClassName="bg-muted text-muted-foreground hover:text-foreground"
        />
      </CardContent>
    </Card>
  );
};

const ErrorMetricsCard = (props: { data?: MetricsDashboardMetric }) => {
  const router = useRouter();
  const range = useRange();
  const { data } = props;

  const top = data?.top ?? [];

  const value = Number.parseFloat(data?.value || "0");
  const previousValue = Number.parseFloat(data?.previousValue || "0");

  const formatter = (value: number) =>
    Intl.NumberFormat("us", {
      maximumFractionDigits: 2,
    })
      .format(value)
      .toString() + "%";

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start pb-2">
        <div className="flex-1">
          <div className="flex space-x-2 text-sm">
            <h4>Error Percentage</h4>
            <InfoTooltip>Error percentage in last {getInfoTip(range)}</InfoTooltip>
          </div>
          <p className="text-xl font-semibold">{formatter(value)}</p>
          <p className="text-sm text-muted-foreground">vs {formatter(previousValue)} last period</p>
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
      <CardContent className="pt-6">
        <div className="mb-2 flex space-x-2 px-2 text-sm">
          <h5 className="text-sm font-medium">Highest error precentage</h5>
        </div>
        <BarList
          data={top.map((row) => ({
            ...row,
            name: row.name === "" ? "unknown" : row.name,
            value: Number.parseFloat(row.value ?? "0"),
            href: {
              pathname: `${router.pathname}/traces`,
              query: {
                organizationSlug: router.query.organizationSlug,
                slug: router.query.slug,
                filterState: createFilterState({
                  operationName: row.name === "" ? "unknown" : row.name,
                }),
                dateRange: createDateRange(range),
              },
            },
          }))}
          valueFormatter={formatter}
          rowHeight={4}
          rowClassName="bg-muted text-muted-foreground hover:text-foreground"
        />
      </CardContent>
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
    props.series
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
    props.series
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
  const range = useRange();
  const graphContext = useContext(GraphContext);

  const formatter = (value: number) => {
    if (value < 1) {
      return (
        Intl.NumberFormat("us", {
          maximumFractionDigits: 3,
        })
          .format(value)
          .toString() + " RPM"
      );
    }

    return (
      Intl.NumberFormat("us", {
        maximumFractionDigits: 0,
      })
        .format(value)
        .toString() + " RPM"
    );
  };

  const { isMobile } = useWindowSize();

  let {
    data: responseData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...getMetricsErrorRate.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      range,
    }),
    keepPreviousData: true,
    refetchOnWindowFocus: false,
  });

  const { data, ticks, domain, timeFormatter } = useChartData(
    range,
    responseData?.series ?? []
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
      <ResponsiveContainer width="100%" height="100%">
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
          <InfoTooltip>Error rate per minute in last {getInfoTip(range)}</InfoTooltip>
        </div>
      </CardHeader>

      <CardContent className="h-[240px]">{content}</CardContent>
    </Card>
  );
};

const OverviewToolbar = () => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const client = useQueryClient();
  const range = useRange();

  const onRangeChange = (value: string) => {
    router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        range: value,
      },
    });
  };

  const metrics = getMetricsDashboard.useQuery({
    federatedGraphName: graphContext?.graph?.name,
    range,
  });

  const errorRate = getMetricsErrorRate.useQuery({
    federatedGraphName: graphContext?.graph?.name,
    range,
  });

  const isFetching = useIsFetching();

  return (
    <AnalyticsToolbar tab="overview">
      <Spacer />
      <Button
        isLoading={!!isFetching}
        onClick={() => {
          client.invalidateQueries(metrics.queryKey);
          client.invalidateQueries(errorRate.queryKey);
        }}
        variant="outline"
      >
        <UpdateIcon />
      </Button>
      <Select value={String(range)} onValueChange={onRangeChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Last hour</SelectItem>
          <SelectItem value="4">Last 4 hours</SelectItem>
          <SelectItem value="24">Last day</SelectItem>
          <SelectItem value="72">Last 3 days</SelectItem>
          <SelectItem value="168">Last week</SelectItem>
        </SelectContent>
      </Select>
    </AnalyticsToolbar>
  );
};

AnalyticsPage.getLayout = (page) =>
  getGraphLayout(
    <PageHeader title="Studio | Analytics">
      <TitleLayout
        title="Analytics"
        subtitle="Comprehensive view into Federated GraphQL Performance"
        toolbar={<OverviewToolbar />}
      >
        {page}
      </TitleLayout>
    </PageHeader>
  );
export default AnalyticsPage;
