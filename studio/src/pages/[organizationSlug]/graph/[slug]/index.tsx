import {
  ComposeStatus,
  ComposeStatusMessage,
} from "@/components/compose-status";
import { CompositionErrorsDialog } from "@/components/composition-errors-dialog";
import { RunRouterCommand } from "@/components/federatedgraphs-cards";
import GraphVisualization from "@/components/graph-visualization";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { MostRequested, RequestChart } from "@/components/operations-overview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CLI } from "@/components/ui/cli";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toolbar } from "@/components/ui/toolbar";
import { formatDateTime } from "@/lib/format-date";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { HomeIcon, RocketIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/router";
import React, { useContext, useState } from "react";
import { TbBook } from "react-icons/tb";
import { ReactFlowProvider } from "reactflow";
import { useQuery } from "@tanstack/react-query";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { Spacer } from "@/components/ui/spacer";
import { formatISO } from "date-fns";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useDateRangeQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { getDashboardAnalyticsView } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";

export const OverviewToolbar = ({ tab }: { tab: "overview" | "readme" }) => {
  const router = useRouter();

  const query = {
    organizationSlug: router.query.organizationSlug,
    slug: router.query.slug,
  };

  return (
    <Toolbar>
      <Tabs value={tab} className="w-full md:w-auto">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <HomeIcon />
              Overview
            </Link>
          </TabsTrigger>
          <TabsTrigger value="readme" asChild>
            <Link
              href={{
                pathname: "/[organizationSlug]/graph/[slug]/readme",
                query,
              }}
              className="flex items-center gap-x-2"
            >
              <TbBook />
              README
            </Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Toolbar>
  );
};

const GraphOverviewPage = () => {
  const graphData = useContext(GraphContext);
  const [open, setOpen] = useState(false);
  const applyParams = useApplyParams();
  const { range, dateRange } = useDateRangeQueryState();
  const analyticsRetention = useFeatureLimit("analytics-retention", 7);

  if (!graphData?.graph) return null;

  const { data: dashboardView, isLoading: dashboardViewLoading } = useQuery({
    ...getDashboardAnalyticsView.useQuery({
      federatedGraphName: graphData.graph.name,
      startDate: formatISO(dateRange.start),
      endDate: formatISO(dateRange.end),
      range,
    }),
  });

  const {
    lastUpdatedAt,
    routingURL,
    labelMatchers,
    connectedSubgraphs,
    isComposable,
    compositionErrors,
    name,
  } = graphData.graph;

  const validGraph = isComposable && !!lastUpdatedAt;
  const emptyGraph = !lastUpdatedAt && !isComposable;

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 space-y-2">
        <div className="flex gap-2">
          <div className="flex flex-wrap gap-2">
            <DatePickerWithRange
              range={range}
              dateRange={dateRange}
              onChange={onDateRangeChange}
              calendarDaysLimit={analyticsRetention}
            />
          </div>

          <Spacer />
        </div>
      </div>
      <div className="grid grid-rows-3 gap-4 lg:grid-cols-2">
        <div className="space-y-2 lg:col-span-1">
          <Card className="flex grow flex-col justify-between">
            <CardHeader>
              <CardTitle>Graph details</CardTitle>
              <CardDescription className="text-xs">
                Last updated:{" "}
                {lastUpdatedAt
                  ? `on ${formatDateTime(new Date(lastUpdatedAt))}`
                  : "Never"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-y-2 text-sm">
              <div className="flex gap-x-4">
                <span className="w-28 text-muted-foreground">Subgraphs</span>
                <span className="w-32">{connectedSubgraphs}</span>
              </div>
              <div className="flex items-start gap-x-4">
                <span className="w-28 flex-shrink-0 text-muted-foreground">
                  Matchers
                </span>
                <div className="flex flex-wrap gap-2 overflow-hidden">
                  {labelMatchers.map((lm: any) => {
                    return (
                      <Badge variant="secondary" key={lm} className="truncate">
                        <span className="truncate">{lm}</span>
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-x-4">
                <span className="w-28 text-muted-foreground">Schema Check</span>
                <ComposeStatus
                  validGraph={validGraph}
                  emptyGraph={emptyGraph}
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col items-start text-sm">
              <span className="text-muted-foreground">Router Url</span>
              <CLI className="mt-1 md:w-full" command={routingURL} />

              <RunRouterCommand
                open={open}
                setOpen={setOpen}
                graphName={name}
                token={graphData.graphToken}
                triggerLabel="Run router locally"
                triggerClassName="mt-3 w-full"
              />
            </CardFooter>
          </Card>
          <Alert
            variant={
              emptyGraph ? "default" : validGraph ? "default" : "destructive"
            }
            className="scrollbar-custom max-h-[15rem] w-full overflow-auto"
          >
            {emptyGraph ? (
              <ExclamationCircleIcon className="h-5 w-5" />
            ) : validGraph ? (
              <RocketIcon className="h-5 w-5" />
            ) : (
              <ExclamationTriangleIcon className="h-5 w-5" />
            )}
            <AlertTitle>
              {emptyGraph
                ? "Heads up!"
                : validGraph
                ? "All good!"
                : "Needs Attention!"}
            </AlertTitle>
            <div className="flex items-center justify-between space-x-2.5">
              <ComposeStatusMessage
                lastUpdatedAt={lastUpdatedAt}
                isComposable={isComposable}
                subgraphsCount={connectedSubgraphs}
              />
              {compositionErrors && (
                <AlertDescription>
                  <CompositionErrorsDialog errors={compositionErrors} />
                </AlertDescription>
              )}
            </div>
          </Alert>
        </div>
        <div className="lg:col-span-1 lg:row-span-2">
          <Card className="h-full">
            <ReactFlowProvider>
              <GraphVisualization
                subgraphMetrics={dashboardView?.subgraphMetrics}
                federatedGraphMetrics={dashboardView?.federatedGraphMetrics}
              />
            </ReactFlowProvider>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <RequestChart
            requestSeries={dashboardView?.requestSeries ?? []}
            isLoading={dashboardViewLoading}
          />
        </div>
        <div className="lg:col-span-1">
          <MostRequested
            data={dashboardView?.mostRequestedOperations ?? []}
            isLoading={dashboardViewLoading}
          />
        </div>
      </div>
    </div>
  );
};

GraphOverviewPage.getLayout = (page: React.ReactNode) => {
  return getGraphLayout(
    <GraphPageLayout
      title="Graph Overview"
      subtitle="An overview of your federated graph"
      toolbar={<OverviewToolbar tab="overview" />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Graph Overview",
    },
  );
};

export default GraphOverviewPage;
