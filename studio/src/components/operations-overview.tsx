import useWindowSize from "@/hooks/use-window-size";
import { useChartData } from "@/lib/insights-helpers";
import { formatMetric, formatPercentMetric } from "@/lib/format-metric";
import {
  OperationRequestCount,
  RequestSeriesItem,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import BarList from "./analytics/barlist";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { useRouter } from "next/router";
import { constructAnalyticsTableQueryState } from "./analytics/constructAnalyticsTableQueryState";
import { ChartTooltip } from "./analytics/charts";
import { Loader } from "@/components/ui/loader";
import {
  useAnalyticsQueryState,
  useDateRangeQueryState,
} from "@/components/analytics/useAnalyticsQueryState";
import { formatDate } from "@/lib/format-date";

const valueFormatter = (number: number) => `${formatMetric(number)}`;

export const RequestChart = ({
  requestSeries,
  isLoading,
}: {
  requestSeries: RequestSeriesItem[];
  isLoading: boolean;
}) => {
  const { range, dateRange } = useAnalyticsQueryState();
  const categorized = useMemo(() => {
    let success = 0;
    let error = 0;
    requestSeries.forEach((o) => {
      success += o.totalRequests - o.erroredRequests;
      error += o.erroredRequests;
    });

    return {
      success,
      error,
    };
  }, [requestSeries]);

  const count = requestSeries.reduce((accumulator, operation) => {
    return accumulator + operation.totalRequests;
  }, 0);

  const { isMobile } = useWindowSize();

  const { data, ticks, domain, timeFormatter } = useChartData(
    range,
    requestSeries,
  );

  const color1 = useId();
  const color2 = useId();

  const requestsColor = "hsl(var(--chart-primary))";

  if (isLoading) {
    return (
      <div className="h-full w-full border">
        <Loader fullscreen />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-y-8 rounded-md border p-4 lg:gap-y-4">
      <div className="flex flex-col gap-x-6 gap-y-2 md:flex-row md:items-center">
        <h2 className="flex items-center gap-x-2">
          <span className="font-semibold leading-none tracking-tight">
            Requests
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs text-muted-foreground">
            {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
          </span>
        </h2>
        <div className="flex items-center gap-x-2 text-sm md:ml-auto">
          <div className="h-3 w-3 rounded-full bg-sky-500" />
          Total
          <Badge variant="secondary">{formatMetric(count)}</Badge>
        </div>
        <div className="flex items-center gap-x-2 text-sm">
          <div className="h-3 w-3 rounded-full bg-destructive/75" />
          Errored
          <Badge variant="secondary">
            {formatPercentMetric((categorized.error / (count || 1)) * 100)} (
            {formatMetric(categorized.error)})
          </Badge>
        </div>
      </div>
      <ResponsiveContainer
        width={"100%"}
        height={250}
        className="my-auto text-xs"
      >
        <AreaChart
          data={data}
          margin={isMobile ? undefined : { right: 60, top: 10 }}
        >
          <defs>
            <linearGradient id={color1} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0da2e7" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#0da2e7" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={color2} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestamp"
            domain={domain}
            ticks={ticks}
            tickFormatter={timeFormatter}
            type="number"
            axisLine={false}
          />
          <YAxis
            tickFormatter={valueFormatter}
            dataKey="totalRequests"
            axisLine={false}
            tickLine={false}
            interval={1}
            hide={isMobile}
          />
          <CartesianGrid strokeDasharray="3 3" className="stroke-secondary" />

          <ChartTooltip formatter={valueFormatter} />

          <Area
            name="Total requests"
            type="monotone"
            dataKey="totalRequests"
            stroke={requestsColor}
            fill={`url(#${color1})`}
          />
          <Area
            name="Errors"
            type="monotone"
            dataKey="erroredRequests"
            stroke="#ef4444"
            fill={`url(#${color2})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const MostRequested = ({
  data,
  isLoading,
}: {
  data: OperationRequestCount[];
  isLoading: boolean;
}) => {
  const { asPath } = useRouter();
  const dr = useDateRangeQueryState();

  const operations = useMemo(() => {
    return data.map((d) => {
      const filterQueryParam = constructAnalyticsTableQueryState({
        operationName: d.operationName,
        operationHash: d.operationHash,
      });
      const currentPath = asPath.split?.("#")?.[0]?.split?.("?")?.[0];

      return {
        hash: d.operationHash,
        name: d.operationName || "-",
        value: d.totalRequests,
        href: `${currentPath}/analytics${filterQueryParam}`,
      };
    });
  }, [data, asPath]);

  if (isLoading) {
    return (
      <div className="h-full w-full border">
        <Loader fullscreen />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-y-4 rounded-md border p-4">
      <h2 className="flex items-center gap-x-2">
        <span className="font-semibold leading-none tracking-tight">
          Top 10 Operations
        </span>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-xs text-muted-foreground">
          {formatDate(dr.dateRange.start)} - {formatDate(dr.dateRange.end)}
        </span>
      </h2>
      <BarList
        rowClassName="bg-purple-400/20"
        data={operations.map((op) => ({
          ...op,
          name: (
            <div className="flex">
              <span className="w-16 text-muted-foreground">
                {op.hash.slice(0, 6)}
              </span>
              <span className="truncate">{op.name}</span>
            </div>
          ),
          key: op.hash + "_" + op.name,
        }))}
        showAnimation={true}
        valueFormatter={valueFormatter}
      />
    </div>
  );
};
