import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import useWindowSize from "@/hooks/use-window-size";
import { formatMetric } from "@/lib/format-metric";
import { createDateRange, useChartData } from "@/lib/insights-helpers";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CubeIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getFieldUsage } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GetFieldUsageResponse } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { format, fromUnixTime } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "../empty-state";
import { GraphContext } from "../layout/graph-layout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Loader } from "../ui/loader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ChartTooltip } from "./charts";
import { createFilterState } from "./constructAnalyticsTableQueryState";

export const FieldUsage = ({
  usageData,
}: {
  usageData: GetFieldUsageResponse;
}) => {
  const router = useRouter();
  const { slug, organizationSlug } = router.query;

  const subgraphs = useContext(GraphContext)?.subgraphs ?? [];

  const range = (router.query.range as string) || "24";

  const { data, ticks, domain, timeFormatter } = useChartData(
    Number(range),
    usageData.requestSeries
  );

  const color1 = useId();
  const color2 = useId();

  const { isMobile } = useWindowSize();

  const onRangeChange = (value: string) => {
    router.push({
      pathname: router.pathname,
      query: {
        ...router.query,
        range: value,
      },
    });
  };

  const valueFormatter = (number: number) => `${formatMetric(number)}`;

  const totalOpsCount = useMemo(() => {
    const names: string[] = [];
    usageData.clients.forEach((item) => {
      item.operations.map((op) => names.push(op.name));
    });
    return names.length;
  }, [usageData]);

  return (
    <div className="flex flex-col gap-y-12">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Requests</h2>
        <Select value={range} onValueChange={onRangeChange}>
          <SelectTrigger className="ml-auto w-[180px]">
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
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
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
            <Area
              name="Requests"
              type="monotone"
              dataKey="totalRequests"
              animationDuration={300}
              stroke="hsl(var(--primary))"
              fill={`url(#${color1})`}
              fillOpacity="1"
              dot={false}
              strokeWidth={1.5}
            />
            <Area
              name="Errors"
              type="monotone"
              dataKey="erroredRequests"
              animationDuration={300}
              stroke="hsl(var(--destructive))"
              fill={`url(#${color2})`}
              fillOpacity="1"
              dot={false}
              strokeWidth={1.5}
            />
            <ChartTooltip formatter={valueFormatter} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h2 className="text-lg font-semibold">Clients and Operations</h2>
        <p className="mt-2 text-muted-foreground">
          Used by {usageData.clients.length} client
          {usageData.clients.length === 1 ? "" : "s"} and {totalOpsCount}{" "}
          operation
          {totalOpsCount === 1 ? "" : "s"}
        </p>
        <Accordion type="single" collapsible className="mt-2 w-full">
          {usageData.clients.map((client) => {
            const clientName = client.name || "unknown";
            const clientVersion = client.version || "n/a";
            const totalRequests = client.operations.reduce((acc, op) => {
              acc += op.count;
              return acc;
            }, 0);

            return (
              <AccordionItem
                key={clientName + clientVersion}
                value={clientName + clientVersion}
              >
                <AccordionTrigger className="hover:bg-secondary/30 hover:no-underline">
                  <div className="flex w-full items-center justify-between gap-x-2">
                    <span>
                      {clientName}{" "}
                      <span className="text-muted-foreground">
                        (version: {clientVersion})
                      </span>
                    </span>
                    <Badge variant="secondary" className="mr-4">
                      {totalRequests} Requests
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="mt-2">
                  <div className="flex flex-col gap-y-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">Hash</TableHead>
                          <TableHead>Operation Name</TableHead>
                          <TableHead className="w-24 text-center">
                            Requests
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {client.operations.map((op) => {
                          return (
                            <TableRow key={op.latestHash}>
                              <TableCell>{op.latestHash.slice(0, 6)}</TableCell>
                              <TableCell>
                                <Link
                                  href={{
                                    pathname: `/[organizationSlug]/graph/[slug]/analytics/traces`,
                                    query: {
                                      organizationSlug:
                                        router.query.organizationSlug,
                                      slug: router.query.slug,
                                      filterState: createFilterState({
                                        operationName: op.name,
                                      }),
                                      dateRange: createDateRange(Number(range)),
                                    },
                                  }}
                                  className="text-primary"
                                >
                                  {op.name || "-"}
                                </Link>
                              </TableCell>
                              <TableCell className="text-center">
                                {op.count}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
      {usageData.meta && (
        <div className="flex flex-col gap-y-12">
          {usageData.meta.subgraphIds.length > 0 && (
            <div className="flex items-start gap-x-4">
              <h2 className="text-lg font-semibold">Subgraphs: </h2>
              <div className="mt-[2px] grid w-max grid-cols-3 gap-x-8">
                {usageData.meta.subgraphIds.map((id) => {
                  const subgraph = subgraphs.find((s) => s.id === id);
                  if (!subgraph) return null;

                  return (
                    <Link
                      key={id}
                      href={`/${organizationSlug}/graph/${slug}/schema/sdl?subgraph=${subgraph.name}`}
                      className="text-primary"
                    >
                      <div className="flex items-center gap-x-1">
                        <CubeIcon className="" />
                        {subgraph.name}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          {usageData.meta.firstSeenTimestamp !== "0" &&
            usageData.meta.latestSeenTimestamp !== "0" && (
              <div className="text-sm">
                <h2 className="text-lg font-semibold">Timestamps</h2>
                <p className="mt-2 text-muted-foreground">
                  First used:{" "}
                  {format(
                    fromUnixTime(Number(usageData.meta.firstSeenTimestamp)),
                    "MMM dd yyyy HH:mm:ss"
                  )}{" "}
                </p>
                <p className=" text-muted-foreground">
                  Latest used:{" "}
                  {format(
                    fromUnixTime(Number(usageData.meta.latestSeenTimestamp)),
                    "MMM dd yyyy HH:mm:ss"
                  )}
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export const FieldUsageSheet = () => {
  const router = useRouter();

  const typename = router.query.typename as string;
  const field = router.query.field as string;
  const range = router.query.range as string;

  const graph = useContext(GraphContext);

  const { data, error, isLoading, refetch } = useQuery({
    ...getFieldUsage.useQuery({
      field,
      typename,
      graphName: graph?.graph?.name,
      range: Number(range) || 24,
    }),
    enabled: !!typename && !!field && !!graph?.graph?.name,
  });

  let content: React.ReactNode;

  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (error || data?.response?.code !== EnumStatusCode.OK) {
    content = (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve your usage data"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  } else if (data) {
    content = <FieldUsage usageData={data} />;
  }

  return (
    <Sheet
      modal
      open={!!typename && !!field}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          const newQuery = { ...router.query };
          delete newQuery["field"];
          delete newQuery["range"];
          router.replace({
            query: newQuery,
          });
        }
      }}
    >
      <SheetContent
        className="scrollbar-custom w-full max-w-full overflow-y-auto sm:max-w-full md:max-w-2xl lg:max-w-3xl"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="mb-12">
          <SheetTitle className="flex flex-wrap items-center gap-x-1.5">
            Field Usage for{" "}
            <code className="break-all rounded bg-secondary px-1.5 text-left text-secondary-foreground">
              {typename}.{field}{" "}
            </code>
          </SheetTitle>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
};
