import { RefreshInterval } from "@/components/analytics/refresh-interval";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  ComposeStatus,
  ComposeStatusMessage,
} from "@/components/compose-status";
import { CompositionErrorsDialog } from "@/components/composition-errors-dialog";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { RunRouterCommand } from "@/components/federatedgraphs-cards";
import GraphVisualization from "@/components/graph-visualization";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { MostRequested, RequestChart } from "@/components/operations-overview";
import { OverviewToolbar } from "@/components/overview/OverviewToolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CLI } from "@/components/ui/cli";
import { CopyButton } from "@/components/ui/copy-button";
import { Separator } from "@/components/ui/separator";
import { Spacer } from "@/components/ui/spacer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { docsBaseURL } from "@/lib/constants";
import { formatDateTime } from "@/lib/format-date";
import { NextPageWithLayout } from "@/lib/page";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { RocketIcon, UpdateIcon } from "@radix-ui/react-icons";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getDashboardAnalyticsView } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useState } from "react";
import { PiCubeFocus } from "react-icons/pi";
import { ReactFlowProvider } from "reactflow";

const GraphOverviewPage: NextPageWithLayout = () => {
  const router = useRouter();
  const graphContext = useContext(GraphContext);
  const [open, setOpen] = useState(false);
  const [showMonographInfo, setShowMonoGraphInfo] = useLocalStorage(
    "showMonographInfo",
    true,
  );
  const applyParams = useApplyParams();
  const client = useQueryClient();
  const { range, dateRange, refreshInterval } = useAnalyticsQueryState(4);
  const analyticsRetention = useFeatureLimit("analytics-retention", 7);

  const getView = getDashboardAnalyticsView.useQuery({
    namespace: graphContext?.graph?.namespace,
    federatedGraphName: graphContext?.graph?.name,
    range,
    startDate: range ? undefined : formatISO(dateRange.start),
    endDate: range ? undefined : formatISO(dateRange.end),
  });
  const {
    data: dashboardView,
    isLoading: dashboardViewLoading,
    isFetching,
  } = useQuery({
    ...getView,
    enabled: !!graphContext?.graph?.name,
    placeholderData: keepPreviousData,
    refetchInterval: refreshInterval,
    refetchOnWindowFocus: false,
  });

  if (!graphContext?.graph) return null;

  const {
    lastUpdatedAt,
    routingURL,
    labelMatchers,
    connectedSubgraphs,
    isComposable,
    compositionErrors,
    name,
    namespace,
    compositionId,
    contract,
    admissionWebhookUrl,
  } = graphContext.graph;

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

  const onRefreshIntervalChange = (value?: number) => {
    applyParams({
      refreshInterval: value ? value.toString() : null,
    });
  };

  const isMonograph = !graphContext.graph.supportsFederation;

  return (
    <GraphPageLayout
      title="Graph Overview"
      subtitle="An overview of your federated graph"
      toolbar={
        <OverviewToolbar tab="overview">
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            <div className="flex w-full flex-wrap gap-2 md:w-auto">
              <DatePickerWithRange
                range={range}
                dateRange={dateRange}
                onChange={onDateRangeChange}
                calendarDaysLimit={analyticsRetention}
              />
            </div>

            <Spacer className="hidden md:block" />

            <Button
              isLoading={!!isFetching}
              onClick={() => {
                client.invalidateQueries({
                  queryKey: getView.queryKey,
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
        </OverviewToolbar>
      }
    >
      {isMonograph && showMonographInfo && (
        <Alert className="mb-4 flex flex-col justify-between gap-4 bg-card md:flex-row md:items-center">
          <AlertDescription>
            This is a monograph without GraphQL Federation enabled. A monograph
            strictly consists of a single subgraph.
          </AlertDescription>
          <div className="flex-shrink-0 space-y-2 md:space-x-2 md:space-y-0">
            <Button
              className="w-full md:w-auto"
              size="sm"
              variant="default"
              asChild
            >
              <Link href={docsBaseURL + "/cli/essentials#monographs"}>
                Learn More
              </Link>
            </Button>
            <Button
              className="w-full md:w-auto"
              size="sm"
              variant="secondary"
              onClick={() => setShowMonoGraphInfo(false)}
            >
              Hide
            </Button>
          </div>
        </Alert>
      )}
      <div className="grid grid-rows-3 gap-4 lg:grid-cols-2">
        <div className="space-y-2 lg:col-span-1">
          <Card className="flex grow flex-col justify-between">
            <CardHeader>
              <CardTitle>
                {contract
                  ? "Contract Graph"
                  : isMonograph
                  ? "Monograph"
                  : "Federated Graph"}{" "}
                Details
              </CardTitle>
              <CardDescription className="text-xs">
                Last updated:{" "}
                {lastUpdatedAt
                  ? `${formatDateTime(new Date(lastUpdatedAt))}`
                  : "Never"}
                <div className="-mt-1 flex items-center gap-x-2">
                  <span className="flex-shrink-0 text-muted-foreground">
                    ID:
                  </span>
                  <span className="w-auto flex-shrink-0">
                    {graphContext.graph.id}
                  </span>
                  <CopyButton tooltip="Copy ID" value={graphContext.graph.id} />
                </div>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-y-3 text-sm">
              <div className="flex gap-x-4">
                <span className="w-28 text-muted-foreground">Name</span>
                <span className="truncate">{graphContext.graph.name}</span>
              </div>
              {!isMonograph && (
                <>
                  <div className="flex gap-x-4">
                    <span className="w-28 text-muted-foreground">
                      Subgraphs
                    </span>
                    <span>{connectedSubgraphs}</span>
                  </div>
                  <div className="flex items-start gap-x-3">
                    <span className="w-28 flex-shrink-0 text-muted-foreground">
                      Matchers
                    </span>
                    <div className="flex flex-wrap gap-2 overflow-hidden">
                      {labelMatchers.length === 0 && (
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger>-</TooltipTrigger>
                          <TooltipContent>
                            This graph will only compose subgraphs without
                            labels
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {labelMatchers.map((lm: any) => {
                        return (
                          <Badge
                            variant="secondary"
                            key={lm}
                            className="truncate"
                          >
                            <span className="truncate">{lm}</span>
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
              <div className="flex items-center gap-x-3">
                <span className="w-28 text-muted-foreground">Composition</span>
                <Badge variant="secondary" className="truncate">
                  {compositionId ? (
                    <Link
                      href={{
                        pathname:
                          "/[organizationSlug]/[namespace]/graph/[slug]/compositions/[compositionId]",
                        query: {
                          ...router.query,
                          compositionId,
                        },
                      }}
                      className="flex items-center space-x-1 hover:underline"
                    >
                      <PiCubeFocus className="h-4 w-4" />{" "}
                      <span>{compositionId.split("-")[0]}</span>
                    </Link>
                  ) : (
                    "N/A"
                  )}
                </Badge>
              </div>
              <div className="flex items-center gap-x-3">
                <span className="w-28 text-muted-foreground">Schema Check</span>
                <ComposeStatus
                  validGraph={validGraph}
                  emptyGraph={emptyGraph}
                />
              </div>

              {contract && (
                <>
                  <Separator className="my-2" />
                  <div className="flex gap-x-4">
                    <span className="w-28 text-muted-foreground">
                      Source Graph
                    </span>
                    <Link
                      href={{
                        pathname:
                          "/[organizationSlug]/[namespace]/graph/[slug]",
                        query: {
                          ...router.query,
                          slug: graphContext.graphs.find(
                            (g) => g.id === contract.sourceFederatedGraphId,
                          )?.name,
                        },
                      }}
                      className="flex items-center space-x-1 text-primary"
                    >
                      <span className="truncate">
                        {
                          graphContext.graphs.find(
                            (g) => g.id === contract.sourceFederatedGraphId,
                          )?.name
                        }
                      </span>
                    </Link>
                  </div>
                  {contract.excludeTags.length > 0 && (
                    <div className="flex items-start gap-x-3">
                      <span className="w-28 flex-shrink-0 text-muted-foreground">
                        Exclude Tags
                      </span>
                      <div className="flex flex-wrap gap-2 overflow-hidden">
                        {contract.excludeTags.map((tag) => {
                          return (
                            <Badge
                              variant="secondary"
                              key={tag}
                              className="truncate"
                            >
                              <span className="truncate">{tag}</span>
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
            <CardFooter className="flex-col items-start text-sm">
              {isMonograph && (
                <div className="mb-4 w-full">
                  <span className="text-muted-foreground">
                    GraphQL Server Url
                  </span>
                  <CLI
                    className="mt-1 md:w-full"
                    command={graphContext.subgraphs[0].routingURL}
                  />
                </div>
              )}
              {admissionWebhookUrl && (
                <div className="mb-4 w-full">
                  <span className="text-muted-foreground">
                    Admission Webhook Url
                  </span>
                  <CLI
                    className="mt-1 md:w-full"
                    command={admissionWebhookUrl}
                  />
                </div>
              )}
              <span className="text-muted-foreground">Router Url</span>
              <CLI className="mt-1 md:w-full" command={routingURL} />
              <RunRouterCommand
                open={open}
                setOpen={setOpen}
                graphName={name}
                namespace={namespace}
                triggerLabel="Run Router locally"
                triggerClassName="mt-3 w-full"
              />
            </CardFooter>
          </Card>

          <Alert
            variant={
              emptyGraph
                ? "destructive"
                : validGraph
                ? "default"
                : "destructive"
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
            <AlertDescription className="space-y-2">
              <ComposeStatusMessage
                lastUpdatedAt={lastUpdatedAt}
                isComposable={isComposable}
                subgraphsCount={connectedSubgraphs}
                isContract={!!contract}
              />
              {compositionErrors && (
                <CompositionErrorsDialog errors={compositionErrors} />
              )}
            </AlertDescription>
          </Alert>
        </div>
        <div className="lg:col-span-1 lg:row-span-2">
          <Card className="h-full">
            <ReactFlowProvider>
              <GraphVisualization
                subgraphMetrics={dashboardView?.subgraphMetrics}
                federatedGraphMetrics={dashboardView?.federatedGraphMetrics}
                supportsFederation={
                  graphContext?.graph?.supportsFederation ?? true
                }
              />
            </ReactFlowProvider>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <MostRequested
            data={dashboardView?.mostRequestedOperations ?? []}
            isLoading={dashboardViewLoading}
          />
        </div>
        <div className="lg:col-span-2">
          <RequestChart
            requestSeries={dashboardView?.requestSeries ?? []}
            isLoading={dashboardViewLoading}
          />
        </div>
      </div>
    </GraphPageLayout>
  );
};

GraphOverviewPage.getLayout = (page) => {
  return getGraphLayout(page, { title: "Graph Overview" });
};

export default GraphOverviewPage;
