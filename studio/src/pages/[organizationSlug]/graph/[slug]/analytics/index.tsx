import BarList from "@/components/analytics/barlist";
import { constructAnalyticsTableQueryState } from "@/components/analytics/constructAnalyticsTableQueryState";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { EmptyState } from "@/components/empty-state";
import { getGraphLayout, GraphContext } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomTooltip } from "@/components/ui/charts";
import { DeltaBadge } from "@/components/ui/delta-badge";
import { Loader } from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spacer } from "@/components/ui/spacer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dateFormatter, useChartData } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common_pb";
import {
  getAnalyticsView,
  getMetricsDashboard,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  GetMetricsDashboardResponse,
  MetricsErrors,
  MetricsLatency,
  MetricsRequests,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { format, subDays, subHours, subMinutes } from "date-fns";
import { useRouter } from "next/router";
import { useContext, useId, useMemo } from "react";
import { FiArrowDown, FiArrowUp } from "react-icons/fi";
import {
  Area,
  AreaChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type OperationAnalytics = {
  name: string;
  content: string;
  operationType: number;
};

const AnalyticsPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

  const { name, filters, pagination, dateRange, page, refreshInterval } =
    useAnalyticsQueryState();

  let { data, isFetching, isLoading, error, refetch } = useQuery({
    ...getMetricsDashboard.useQuery({
      federatedGraphName: graphContext?.graph?.name,
      // name,
      // config: {
      //   filters,
      //   dateRange,
      //   pagination,
      // },
    }),
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchInterval: refreshInterval.value,
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
      <div className="grid grid-cols-3 gap-4">
        <RequestMetricsCard data={data?.requests} />
        <LatencyMetricsCard data={data?.latency} />
        <ErrorMetricsCard data={data?.errors} />
      </div>

      <RequestRate />
    </div>
  );
};

const RequestMetricsCard = (props: { data?: MetricsRequests }) => {
  const router = useRouter();

  const { data } = props;

  const top = data?.top ?? [];

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start">
        <div className="flex-1">
          <h4 className="text-sm text-muted-foreground">Request Rate</h4>
          <p className="text-xl font-semibold">{data?.median}</p>
        </div>

        <DeltaBadge type={requests.deltaType} value={requests.deltaValue} />
      </CardHeader>
      <CardContent className="border-b pb-2">
        <Sparkline series={data?.series ?? []} />
      </CardContent>
      <CardContent className="pt-6">
        <BarList
          data={top.map((row) => ({
            ...row,
            href: `${router.asPath}/traces${constructAnalyticsTableQueryState({
              operationName: row.name,
            })}`,
          }))}
          valueFormatter={(number: number) =>
            Intl.NumberFormat("us").format(number).toString()
          }
          rowHeight={4}
          rowClassName="bg-muted text-muted-foreground hover:text-foreground"
        />
      </CardContent>
    </Card>
  );
};

const LatencyMetricsCard = (props: { data?: MetricsLatency }) => {
  const router = useRouter();

  const { data } = props;

  const top = data?.top ?? [];

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start">
        <div className="flex-1">
          <h4 className="text-sm text-muted-foreground">P95 Latency</h4>
          <p className="text-xl font-semibold">{data?.p95 || 0}</p>
        </div>

        <DeltaBadge type={latency.deltaType} value={latency.deltaValue} />
      </CardHeader>
      <CardContent className="border-b pb-2">
        <Sparkline series={data?.series ?? []} />
      </CardContent>
      <CardContent className="pt-6">
        <BarList
          data={top.map((row) => ({
            ...row,
            href: `${router.asPath}/traces${constructAnalyticsTableQueryState({
              operationName: row.name,
            })}`,
          }))}
          valueFormatter={(number: number) =>
            Intl.NumberFormat("us").format(number).toString() + "ms"
          }
          rowHeight={4}
          rowClassName="bg-muted text-muted-foreground hover:text-foreground"
        />
      </CardContent>
    </Card>
  );
};

const ErrorMetricsCard = (props: { data?: MetricsErrors }) => {
  const router = useRouter();

  const { data } = props;

  const top = data?.top ?? [];

  return (
    <Card className="bg-transparent">
      <CardHeader className="flex flex-row items-start">
        <div className="flex-1">
          <h4 className="text-sm text-muted-foreground">Error Percentage</h4>
          <p className="text-xl font-semibold">{data?.percentage}%</p>
        </div>

        <DeltaBadge type={errors.deltaType} value={errors.deltaValue} />
      </CardHeader>
      <CardContent className="border-b pb-2">
        <ErrorPercentChart series={data?.series ?? []} />
      </CardContent>
      <CardContent className="pt-6">
        <BarList
          data={top.map((row) => ({
            ...row,
            href: `${router.asPath}/traces${constructAnalyticsTableQueryState({
              operationName: row.name,
            })}`,
          }))}
          valueFormatter={(number: number) =>
            Intl.NumberFormat("us").format(number).toString() + "%"
          }
          rowHeight={4}
          rowClassName="bg-muted text-muted-foreground hover:text-foreground"
        />
      </CardContent>
    </Card>
  );
};

interface SparklineProps {
  series: any[];
  className?: string;
}

const Sparkline: React.FC<SparklineProps> = (props) => {
  const id = useId();
  const { data, ticks, domain, timeFormatter } = useChartData(
    7 * 24,
    props.series
  );

  const strokeColor = "hsl(var(--chart-primary))";

  return (
    <div className={cn("-mx-6 h-20", props.className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 0, bottom: 8, left: 0 }}
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
            type="natural"
            dataKey="value"
            animationDuration={300}
            stroke={strokeColor}
            fill={`url(#${id}-gradient-previous)`}
            dot={false}
            strokeWidth={1.5}
            opacity="0.4"
            strokeDasharray="4 2"
          />
          <Area
            type="natural"
            dataKey="previousValue"
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const ErrorPercentChart: React.FC<SparklineProps> = (props) => {
  const id = useId();
  const { data, ticks, domain, timeFormatter } = useChartData(
    7 * 24,
    props.series
  );

  return (
    <div className={cn("-mx-6 h-20", props.className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 0, bottom: 8, left: 0 }}
        >
          <defs>
            <linearGradient id={`${id}-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={"hsl(var(--muted-foreground))"} />
              <stop offset="95%" stopColor={"hsl(var(--muted))"} />
            </linearGradient>
          </defs>
          <Area
            type="natural"
            dataKey="compareValue"
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
            type="natural"
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const RequestRate = () => {
  const series = useMemo(
    () =>
      generateMinuteSeries().map((s) => {
        const value = s.value * 100;
        return {
          timestamp: s.timestamp,
          errors: Math.floor(
            ((value / 100) * Math.floor(Math.random() * 5 * 100)) / 100
          ),
          value: value,
        };
      }),
    []
  );

  const id = useId();
  const { data, ticks, domain, timeFormatter } = useChartData(7 * 24, series);

  return (
    <Card className="bg-transparent">
      <CardHeader>
        <CardTitle>Error rate over time</CardTitle>
      </CardHeader>

      <CardContent className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 0, bottom: 8, left: 0 }}
          >
            <defs>
              <linearGradient id={`${id}-gradient`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={"hsl(var(--muted-foreground))"} />
                <stop offset="95%" stopColor={"hsl(var(--muted))"} />
              </linearGradient>
            </defs>
            <Area
              name="Request rate"
              type="natural"
              dataKey="value"
              animationDuration={300}
              stroke="hsl(var(--muted-foreground))"
              fill={`url(#${id}-gradient)`}
              dot={false}
              strokeWidth={1.5}
              opacity="0.4"
            />
            <Area
              name="Error rate"
              type="natural"
              dataKey="errors"
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
              tickFormatter={(value) => {
                return format(value, "HH:mm");
              }}
              type="number"
              interval="preserveStart"
              minTickGap={60}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "13px" }}
            />

            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "13px" }}
            />

            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ fontSize: "13px", marginTop: "-10px" }}
            />

            <Tooltip
              content={(props) => (
                <CustomTooltip
                  {...props}
                  label={
                    <div>
                      {dateFormatter(props.label, false)}
                      <p>
                        Error rate: {props.payload?.[0]?.payload?.errors ?? 0}
                      </p>
                    </div>
                  }
                />
              )}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

const fallbackData = [
  {
    timestamp: subDays(new Date(), 1),
    value: 0,
  },
  {
    timestamp: new Date(),
    value: 0,
  },
];

const generateSeries = () => {
  const series = [];
  for (let i = 0; i < 24; i++) {
    series.push({
      timestamp: subHours(new Date(), i),
      value: Math.floor(Math.random() * 100),
      previousValue: Math.floor(Math.random() * 100),
    });
  }
  return series;
};

const generateMinuteSeries = () => {
  const series = [];
  for (let i = 0; i < 24 * 12; i++) {
    series.push({
      timestamp: subMinutes(new Date(), i),
      value: Math.floor(Math.random() * 100),
      previousValue: Math.floor(Math.random() * 100),
    });
  }
  return series;
};

const requests = {
  deltaType: "increase-positive" as any,
  deltaValue: "200",
  value: "13.000 RPM",
  series: generateSeries(),
  data: [
    { name: "employee", value: 1230 },
    { name: "employees", value: 751 },
    { name: "team_mates", value: 471 },
    { name: "updateEmployee", value: 280 },
    { name: "createEmployee", value: 78 },
  ],
};

const latency = {
  deltaType: "increase-negative" as any,
  deltaValue: "50",
  value: "130ms",
  series: generateSeries(),
  data: [
    { name: "createEmployee", value: 453 },
    { name: "updateEmployee", value: 351 },
    { name: "team_mates", value: 271 },
    { name: "employees", value: 191 },
    { name: "employee", value: 121 },
  ],
};

const errors = {
  deltaType: "decrease-positive" as any,
  deltaValue: "-0.1",
  value: "0.3%",
  series: generateSeries().map((s) => {
    return {
      timestamp: s.timestamp,
      value:
        ((s.previousValue / 100) * Math.floor(Math.random() * 50 * 100)) / 100,
      compareValue: s.previousValue,
    };
  }),
  data: [
    { name: "GraphQLParseFailure", value: 100 },
    { name: "updateEmployee", value: 82 },
    { name: "createEmployee", value: 54 },
    { name: "team_mates", value: 10 },
  ],
};

const OverviewToolbar = () => {
  return (
    <AnalyticsToolbar tab="overview">
      <Spacer />
      <Select value="24">
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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
