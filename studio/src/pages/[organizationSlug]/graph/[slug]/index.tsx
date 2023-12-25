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
import { OperationsOverview } from "@/components/operations-overview";
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
import { useContext, useState } from "react";
import { TbBook } from "react-icons/tb";
import { ReactFlowProvider } from "reactflow";

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

  if (!graphData?.graph) return null;

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

  return (
    <div className="flex flex-col flex-wrap items-stretch gap-y-4 pb-4 lg:flex-row lg:gap-x-4">
      <div className="order-1 flex flex-col justify-between space-y-2 lg:w-1/3">
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
                {labelMatchers.map((lm) => {
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
              <ComposeStatus validGraph={validGraph} emptyGraph={emptyGraph} />
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
      <div className="order-3 lg:order-2 lg:w-2/3 lg:flex-1">
        <Card className="h-full">
          <ReactFlowProvider>
            <GraphVisualization />
          </ReactFlowProvider>
        </Card>
      </div>
      <OperationsOverview federatedGraphName={graphData.graph.name} />
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
