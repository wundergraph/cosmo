import BarList from "@/components/analytics/barlist";
import { ChartTooltip } from "@/components/analytics/charts";
import { createFilterState } from "@/components/analytics/constructAnalyticsTableQueryState";
import { DeltaBadge } from "@/components/analytics/delta-badge";
import {
  AnalyticsFilter,
  AnalyticsFilters,
} from "@/components/analytics/filters";
import { optionConstructor } from "@/components/analytics/getDataTableFilters";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip } from "@/components/info-tooltip";
import { GraphContext } from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import useWindowSize from "@/hooks/use-window-size";
import {
  formatDurationMetric,
  formatMetric,
  formatPercentMetric,
} from "@/lib/format-metric";
import { useChartData } from "@/lib/insights-helpers";
import { cn } from "@/lib/utils";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { keepPreviousData } from "@tanstack/react-query";
import { useQuery } from "@connectrpc/connect-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getMetricsErrorRate } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  AnalyticsViewResultFilter,
  MetricsDashboardMetric,
  MetricsTopItem,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { differenceInHours, formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  Area,
  AreaChart,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Line,
  LineChart,
} from "recharts";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

export const MAX_URL_LENGTH = 10000;
export const MAX_FILTER_SIZE = 10 * 1024; // 10KB in bytes

/**
 * Calculates the byte size of a string (UTF-8 encoded)
 */
export const calculateByteSize = (str: string): number => {
  return new Blob([str]).size;
};

/**
 * Checks if filter state exceeds URL length or size limits.
 * Returns an object with exceeded flag and reason message.
 */
export const checkFilterLimits = (
  router: ReturnType<typeof useRouter>,
  filterState: string,
): { exceeded: boolean; reason?: string } => {
  const urlLength = calculateUrlLength(router, { filterState });
  const filterSize = calculateByteSize(filterState);

  if (urlLength > MAX_URL_LENGTH) {
    return {
      exceeded: true,
      reason: `URL would exceed maximum length of ${MAX_URL_LENGTH.toLocaleString()} characters`,
    };
  }

  if (filterSize > MAX_FILTER_SIZE) {
    return {
      exceeded: true,
      reason: `Filter state would exceed maximum size of ${(MAX_FILTER_SIZE / 1024).toFixed(0)}KB`,
    };
  }

  return { exceeded: false };
};

/**
 * Calculates the length of the URL that would be generated from the given query parameters.
 * This simulates what the URL would look like after applying the new parameters.
 *
 * Note: We calculate the full URL including origin because browsers have limits on total URL length.
 */
export const calculateUrlLength = (
  router: ReturnType<typeof useRouter>,
  newParams: Record<string, string | string[] | null | undefined>,
): number => {
  // Merge existing query params with new params
  // Remove params that are being set to null, keep others, and add/update new params
  const mergedQuery: Record<string, string | string[]> = {};

  // First, copy existing params that aren't being replaced or removed
  for (const [key, value] of Object.entries(router.query)) {
    if (!newParams.hasOwnProperty(key)) {
      // Keep existing param if not in newParams
      if (value !== undefined && value !== null) {
        mergedQuery[key] = value as string | string[];
      }
    } else if (newParams[key] !== null) {
      // Keep existing param if newParams[key] is not null (will be overridden below)
      if (value !== undefined && value !== null) {
        mergedQuery[key] = value as string | string[];
      }
    }
    // If newParams[key] is null, we skip it (removes the param)
  }

  // Then, add/update with new params (excluding null values)
  for (const [key, value] of Object.entries(newParams)) {
    if (value !== null && value !== undefined) {
      mergedQuery[key] = value;
    }
  }

  // Build the query string - Next.js formats arrays as multiple key=value pairs
  const queryParts: string[] = [];
  for (const [key, value] of Object.entries(mergedQuery)) {
    const encodedKey = encodeURIComponent(key);
    if (Array.isArray(value)) {
      // Arrays become multiple query params with same key
      for (const v of value) {
        queryParts.push(`${encodedKey}=${encodeURIComponent(String(v))}`);
      }
    } else {
      queryParts.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
    }
  }

  const queryString = queryParts.join("&");

  // Get the pathname (without existing query string)
  const pathname = router.asPath.split("?")[0];

  // Construct the full URL (origin + pathname + query string)
  // Browsers limit the full URL length, so we include origin
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const fullUrl = queryString
    ? `${origin}${pathname}?${queryString}`
    : `${origin}${pathname}`;

  return fullUrl.length;
};

/**
 * Checks if adding a new filter value would exceed the URL length or size limits.
 * Returns true if either limit would be exceeded, false otherwise.
 */
export const wouldExceedUrlLimit = (
  router: ReturnType<typeof useRouter>,
  currentFilters: { id: string; value: string[] }[],
  filterId: string,
  newValue: string[],
): boolean => {
  if (!newValue || newValue.length === 0) {
    // Removing filters - always allow
    return false;
  }

  // Create a deep copy to avoid mutating the original
  const newSelected = currentFilters.map((f) => ({
    ...f,
    value: [...f.value],
  }));
  const index = newSelected.findIndex((f) => f.id === filterId);

  // Update or add the filter
  if (index >= 0) {
    newSelected[index].value = newValue;
  } else {
    newSelected.push({
      id: filterId,
      value: newValue,
    });
  }

  let stringifiedFilters;
  try {
    stringifiedFilters = JSON.stringify(newSelected);
  } catch {
    stringifiedFilters = "[]";
  }

  // Use shared validation function
  const { exceeded } = checkFilterLimits(router, stringifiedFilters);
  return exceeded;
};

export const getInfoTip = (range?: number) => {
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

const useTimeRange = () => {
  const { range, dateRange } = useAnalyticsQueryState();
  return (
    (dateRange ? differenceInHours(dateRange.end, dateRange.start) : range) ??
    24
  );
};

const useSelectedFilters = () => {
  const router = useRouter();
  const { toast } = useToast();

  const selectedFilters = useMemo(() => {
    try {
      return JSON.parse(router.query.filterState?.toString() ?? "[]");
    } catch {
      return [];
    }
  }, [router.query.filterState]);

  // Validate URL length and filter size when filters are loaded from URL (e.g., manual manipulation)
  useEffect(() => {
    if (!router.isReady || !router.query.filterState) return;

    const { exceeded, reason } = checkFilterLimits(
      router,
      router.query.filterState as string,
    );

    if (exceeded) {
      toast({
        title: "Filter limit reached",
        description: `${reason}. Filters have been reset.`,
      });

      // Reset to clean URL by removing filterState entirely
      const { filterState, ...cleanQuery } = router.query;
      router.replace(
        {
          query: cleanQuery,
        },
        undefined,
        { shallow: true },
      );
    }
    // Only depend on the specific values we check, not the whole router/toast objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.filterState]);

  return selectedFilters as { id: string; value: string[] }[];
};

export const useMetricsFilters = (filters: AnalyticsViewResultFilter[]) => {
  const router = useRouter();
  const { toast } = useToast();

  const applyNewParams = useCallback(
    (newParams: Record<string, string | null>, unset?: string[]) => {
      const mergedParams = Object.fromEntries(
        Object.entries(router.query).filter(([key]) => !unset?.includes(key)),
      );

      router.push({
        query: {
          ...mergedParams,
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
        // Create a deep copy to avoid mutating the original
        const newSelected = selectedFilters.map((f) => ({
          ...f,
          value: [...f.value],
        }));
        const index = newSelected.findIndex((f) => f.id === filter.columnName);

        if (!value || value.length === 0) {
          if (index !== -1) {
            newSelected.splice(index, 1);
          }
        } else if (index !== -1 && newSelected[index]) {
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

  // Check if current URL is at or near the limit
  // We need to recalculate when router.query changes
  const currentUrlLength = useMemo(() => {
    return calculateUrlLength(router, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query, router.asPath]);

  const isUrlLimitReached = currentUrlLength >= MAX_URL_LENGTH;

  // Create disabled filters list when URL limit is reached
  // Allow removal of existing filters but prevent adding new ones
  // Use a ref to track the latest selectedFilters to avoid stale closures
  const selectedFiltersRef = useRef(selectedFilters);
  selectedFiltersRef.current = selectedFilters;

  const filtersListWithValidation = useMemo(() => {
    return filtersList.map((filter) => {
      return {
        ...filter,
        // ALWAYS validate selection to check if NEW addition would exceed the limit
        validateSelection: (value: string[]) => {
          // Use ref to get latest selectedFilters to avoid stale closure
          const currentSelectedFilters = selectedFiltersRef.current;

          // Check if adding/modifying this filter would exceed the limit
          if (
            wouldExceedUrlLimit(
              router,
              currentSelectedFilters,
              filter.id,
              value,
            )
          ) {
            toast({
              title: "Filter limit reached",
              description: `Maximum URL length of ${MAX_URL_LENGTH.toLocaleString()} characters reached. Please remove some filters before adding new ones.`,
            });
            return false; // Validation failed - prevents onSelect from being called
          }

          return true; // Validation passed - allows onSelect to be called
        },
        onSelect: filter.onSelect, // Use original onSelect without wrapping
      };
    });

    // Only filtersList should trigger recalculation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersList]);

  return {
    filtersList: filtersListWithValidation,
    selectedFilters,
    resetFilters,
    isUrlLimitReached,
  };
};

interface MetricsFiltersProps {
  filters: AnalyticsViewResultFilter[];
}

export const MetricsFilters: React.FC<MetricsFiltersProps> = (props) => {
  const { filters } = props;

  const { filtersList } = useMetricsFilters(filters);

  return <AnalyticsFilters filters={filtersList} />;
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
  isSubgraphAnalytics?: boolean;
  queryParams?: Record<string, string | number>;
}> = ({ title, items, formatter, isSubgraphAnalytics, queryParams = {} }) => {
  const router = useRouter();
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  const range = router.query.range;
  const dateRange = router.query.dateRange;

  const hasPersisted = items.some((i) => i.isPersisted);

  return (
    <CardContent className="pt-6">
      <div className="mb-2 flex space-x-2 text-sm">
        {isSubgraphAnalytics ? (
          <h5 className="group inline-flex cursor-default rounded-md px-2 py-1 text-sm font-medium">
            {title}
            <ChevronRightIcon className="h4 ml-1 w-4" />
          </h5>
        ) : (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <h5 className="group text-sm font-medium">
                <Link
                  href={{
                    pathname: `${router.pathname}/traces`,
                    query: {
                      organizationSlug,
                      namespace,
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
        )}
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
          href: isSubgraphAnalytics
            ? undefined
            : {
                pathname: `${router.pathname}/traces`,
                query: {
                  organizationSlug,
                  namespace,
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

interface SparklineProps {
  series: any[];
  timeRange: number;
  className?: string;
  valueFormatter?: (value: any) => any;
  syncId?: string;
}

const Sparkline: React.FC<SparklineProps> = (props) => {
  const { timeRange = 24, valueFormatter, syncId, className } = props;
  const id = useId();

  const { data, ticks, domain, timeFormatter } = useChartData(
    timeRange,
    props.series,
  );

  const strokeColor = "hsl(var(--chart-primary))";

  return (
    <div className={cn("-mx-6 h-20", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 6, bottom: 8, left: 6 }}
          syncId={syncId}
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

export const RequestMetricsCard = (props: {
  data?: MetricsDashboardMetric;
  isSubgraphAnalytics?: boolean;
  syncId?: string;
  showTopList?: boolean;
  chartClassName?: string;
}) => {
  const timeRange = useTimeRange();
  const { data, syncId, showTopList = true, chartClassName } = props;

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
            <div>
              <InfoTooltip>RPM in {getInfoTip(timeRange)}</InfoTooltip>
            </div>
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
          timeRange={timeRange}
          syncId={syncId}
          className={chartClassName}
        />
      </CardContent>
      {showTopList && (
        <TopList
          title="Highest RPM"
          items={top}
          formatter={formatter}
          queryParams={{ group: "OperationName" }}
          isSubgraphAnalytics={props.isSubgraphAnalytics}
        />
      )}
    </Card>
  );
};

export const LatencyMetricsCard = (props: {
  data?: MetricsDashboardMetric;
  isSubgraphAnalytics?: boolean;
  syncId?: string;
  showTopList?: boolean;
  chartClassName?: string;
}) => {
  const timeRange = useTimeRange();
  const { data, syncId, showTopList = true, chartClassName } = props;

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
            <InfoTooltip>P95 latency in {getInfoTip(timeRange)}</InfoTooltip>
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
          timeRange={timeRange}
          syncId={syncId}
          className={chartClassName}
        />
      </CardContent>
      {showTopList && (
        <TopList
          title="Highest latency"
          items={top}
          formatter={formatter}
          queryParams={{ group: "OperationName", sort: "p95", sortDir: "desc" }}
          isSubgraphAnalytics={props.isSubgraphAnalytics}
        />
      )}
    </Card>
  );
};

export const ErrorMetricsCard = (props: {
  data?: MetricsDashboardMetric;
  isSubgraphAnalytics?: boolean;
  syncId?: string;
  showTopList?: boolean;
  chartClassName?: string;
}) => {
  const timeRange = useTimeRange();
  const { data, syncId, showTopList = true, chartClassName } = props;

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
            <InfoTooltip>
              Error percentage in {getInfoTip(timeRange)}
            </InfoTooltip>
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
          timeRange={timeRange}
          syncId={syncId}
          className={chartClassName}
        />
      </CardContent>
      {showTopList && (
        <TopList
          title="Highest error percentage"
          items={top}
          formatter={formatter}
          queryParams={{
            group: "OperationName",
            sort: "errors",
            sortDir: "desc",
          }}
          isSubgraphAnalytics={props.isSubgraphAnalytics}
        />
      )}
    </Card>
  );
};

const ErrorPercentChart: React.FC<SparklineProps> = (props) => {
  const { timeRange = 24, valueFormatter, syncId, className } = props;
  const id = useId();
  const { data, ticks, domain, timeFormatter } = useChartData(
    timeRange,
    props.series,
  );

  return (
    <div className={cn("-mx-6 h-20", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 6, bottom: 8, left: 6 }}
          syncId={syncId}
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

export const ErrorRateOverTimeCard = ({ syncId }: { syncId?: string }) => {
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
  } = useQuery(
    getMetricsErrorRate,
    {
      federatedGraphName: graphContext?.graph?.name,
      namespace: graphContext?.graph?.namespace,
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

export const LatencyDistributionCard = ({
  series,
  syncId,
}: {
  series: any[];
  syncId?: string;
}) => {
  const [activeLatencies, setActiveLatencies] = useState({
    p50: false,
    p90: false,
    p99: false,
  });
  const timeRange = useTimeRange();
  const formatter = (value: number) => {
    return formatDurationMetric(value, {
      maximumFractionDigits: 3,
    });
  };

  const { isMobile } = useWindowSize();
  const { data, ticks, domain, timeFormatter } = useChartData(
    timeRange,
    series,
  );

  const p50StrokeColor = "hsl(var(--chart-primary))";
  const p90StrokeColor = "hsl(var(--warning))";
  const p99StrokeColor = "hsl(var(--destructive))";

  return (
    <Card className="bg-transparent">
      <CardHeader>
        <div className="flex space-x-2">
          <CardTitle>Latency</CardTitle>
          <InfoTooltip>Latency in {getInfoTip(timeRange)}</InfoTooltip>
        </div>
      </CardHeader>

      <CardContent className="h-[240px]">
        <ResponsiveContainer width="99%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
            syncId={syncId}
          >
            <Line
              name="p99"
              type="monotone"
              dataKey="p99"
              animationDuration={300}
              dot={false}
              hide={activeLatencies.p99}
              stroke={p99StrokeColor}
              strokeWidth={1.5}
            />
            <Line
              name="p90"
              type="monotone"
              dataKey="p90"
              animationDuration={300}
              dot={false}
              hide={activeLatencies.p90}
              stroke={p90StrokeColor}
              strokeWidth={1.5}
            />
            <Line
              name="p50"
              type="monotone"
              dataKey="p50"
              animationDuration={300}
              dot={false}
              hide={activeLatencies.p50}
              stroke={p50StrokeColor}
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
              tickFormatter={formatter}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: "13px" }}
            />

            <Legend
              verticalAlign="top"
              align="right"
              inactiveColor="hsl(var(--muted-foreground) / 0.45)"
              wrapperStyle={{ fontSize: "13px", marginTop: "-10px" }}
              onClick={({ dataKey, inactive }) => {
                setActiveLatencies({
                  ...activeLatencies,
                  [dataKey]: !inactive,
                });
              }}
            />

            <ChartTooltip formatter={formatter} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
