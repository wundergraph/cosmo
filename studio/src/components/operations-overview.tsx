import useWindowSize from "@/hooks/use-window-size";
import { dateFormatter, useChartData } from "@/lib/insights-helpers";
import { cn, formatNumber } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { getDashboardAnalyticsView } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
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
import { EmptyState } from "./empty-state";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Loader } from "./ui/loader";
import { Separator } from "./ui/separator";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { useRouter } from "next/router";
import { constructAnalyticsTableQueryState } from "./analytics/constructAnalyticsTableQueryState";
import { ChartTooltip, CustomTooltip } from "./analytics/charts";

const valueFormatter = (number: number) => `${formatNumber(number)}`;

const RequestChart = ({
  requestSeries,
}: {
  requestSeries: RequestSeriesItem[];
}) => {
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
    7 * 24,
    requestSeries
  );

  const color1 = useId();
  const color2 = useId();

  return (
    <div className="flex h-full w-full flex-col gap-y-8 rounded-md border p-4 lg:w-3/5 lg:gap-y-4">
      <div className="flex flex-col gap-x-6 gap-y-2 md:flex-row md:items-center">
        <h2 className="flex items-center gap-x-2">
          <span>Requests</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-xs text-muted-foreground">1 Week</span>
        </h2>
        <div className="flex items-center gap-x-2 text-sm md:ml-auto">
          <div className="h-3 w-3 rounded-full bg-primary" />
          Total
          <Badge variant="secondary">{count}</Badge>
        </div>
        <div className="flex items-center gap-x-2 text-sm">
          <div className="h-3 w-3 rounded-full bg-destructive/75" />
          Errored
          <Badge variant="secondary">
            {((categorized.error / (count || 1)) * 100).toFixed(2)}%
          </Badge>
        </div>
      </div>
      <ResponsiveContainer
        width={"100%"}
        height={200}
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

          <ChartTooltip
            content={(props) => {
              return (
                <div className={cn(props.wrapperClassName, "space-y-2")}>
                  <p>{dateFormatter(props.label, false)}</p>
                  <p className="text-success">
                    Success:{" "}
                    {props.payload?.[0]?.payload?.totalRequests
                      ? props.payload?.[0]?.payload?.totalRequests -
                          props.payload?.[0]?.payload?.erroredRequests ?? 0
                      : 0}
                  </p>
                  <p className="text-destructive">
                    Errors: {props.payload?.[0]?.payload?.erroredRequests ?? 0}
                  </p>
                </div>
              );
            }}
          />
          <Area
            name="Total requests"
            type="monotone"
            dataKey="totalRequests"
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

const MostRequested = ({ data }: { data: OperationRequestCount[] }) => {
  const { asPath } = useRouter();

  const operations = useMemo(() => {
    return data.map((d) => {
      const filterQueryParam = constructAnalyticsTableQueryState({
        operationName: d.operationName,
      });
      const currentPath = asPath.split?.("#")?.[0]?.split?.("?")?.[0];

      return {
        name: d.operationName || "-",
        value: d.totalRequests,
        href: `${currentPath}/analytics${filterQueryParam}`,
      };
    });
  }, [data, asPath]);

  return (
    <div className="flex h-full w-full flex-col gap-y-4 rounded-md border p-4 lg:w-2/5">
      <h2 className="flex items-center gap-x-2">
        <span>Most Requested</span>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-xs text-muted-foreground">1 Week</span>
      </h2>
      <BarList
        data={operations}
        showAnimation={true}
        valueFormatter={valueFormatter}
      />
    </div>
  );
};

export const OperationsOverview = ({
  federatedGraphName,
}: {
  federatedGraphName: string;
}) => {
  const { data, isLoading, error, refetch } = useQuery(
    getDashboardAnalyticsView.useQuery({
      federatedGraphName,
    })
  );

  if (isLoading) {
    return (
      <div className="order-2 h-72 w-full border lg:order-last">
        <Loader fullscreen />
      </div>
    );
  }

  if (error || data?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        className="order-2 h-72 border lg:order-last"
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve weekly analytics data"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="order-2 flex w-full flex-col items-center gap-4 lg:order-last lg:flex-row">
      <RequestChart requestSeries={data?.requestSeries ?? []} />
      <MostRequested data={data?.mostRequestedOperations ?? []} />
    </div>
  );
};
