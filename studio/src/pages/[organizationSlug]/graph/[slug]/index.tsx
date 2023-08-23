import {
  ComposeStatus,
  ComposeStatusMessage,
} from "@/components/compose-status";
import GraphVisualization from "@/components/graph-visualization";
import { GraphContext, getGraphLayout } from "@/components/layout/graph-layout";
import { PageHeader } from "@/components/layout/head";
import { TitleLayout } from "@/components/layout/title-layout";
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
import { NextPageWithLayout } from "@/lib/page";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { RocketIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";
import { useRouter } from "next/router";
import { useContext } from "react";
import { ReactFlowProvider } from "reactflow";

const Details = () => {
  const graphData = useContext(GraphContext);

  if (!graphData?.graph) return null;

  const {
    lastUpdatedAt,
    routingURL,
    labelMatchers,
    connectedSubgraphs,
    isComposable,
    compositionErrors,
  } = graphData.graph;

  const validGraph = isComposable && !!lastUpdatedAt;
  const emptyGraph = !lastUpdatedAt && !isComposable;

  return (
    <div className="flex flex-col flex-wrap items-stretch gap-y-4 pb-4 lg:flex-row lg:gap-x-4">
      <div className="order-1 flex flex-col justify-between space-y-3 lg:w-1/3">
        <Card className="flex grow flex-col justify-between">
          <CardHeader>
            <CardTitle>Graph details</CardTitle>
            <CardDescription>
              Last updated:{" "}
              {lastUpdatedAt
                ? `on ${format(new Date(lastUpdatedAt), "dd MMMM yyyy HH:mm")}`
                : "Never"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-y-2 text-sm">
            <div className="flex gap-x-4">
              <span className="w-28">Subgraphs</span> :
              <span className="w-32">{connectedSubgraphs}</span>
            </div>
            <div className="flex items-start gap-x-4">
              <span className="w-28 flex-shrink-0">Matchers</span> :
              <div className="flex flex-wrap gap-2">
                {labelMatchers.map((lm) => {
                  return (
                    <Badge variant="secondary" key={lm}>
                      {lm}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-x-4">
              <span className="w-28">Schema Check</span> :
              <ComposeStatus validGraph={validGraph} emptyGraph={emptyGraph} />
            </div>
          </CardContent>
          <CardFooter className="flex-col items-start">
            <span className="text-xs text-slate-500 dark:text-slate-300">
              Router Url:
            </span>
            <CLI className="mt-1 md:w-full" command={routingURL} />
          </CardFooter>
        </Card>
        <Alert
          variant={
            emptyGraph ? "default" : validGraph ? "default" : "destructive"
          }
          className="scrollbar-custom max-h-[7rem] w-full overflow-auto"
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
          <AlertDescription>
            <ComposeStatusMessage
              errors={compositionErrors}
              isComposable={isComposable}
              lastUpdatedAt={lastUpdatedAt}
              subgraphsCount={connectedSubgraphs}
            />
          </AlertDescription>
        </Alert>
      </div>
      <div className="order-3 h-[25rem] lg:order-2 lg:w-2/3 lg:flex-1">
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

const GraphPage: NextPageWithLayout = () => {
  const router = useRouter();
  const slug = router.query.slug as string;

  return (
    <PageHeader title="Studio | Overview">
      <TitleLayout title={slug} subtitle="An overview of your federated graph">
        <Details />
      </TitleLayout>
    </PageHeader>
  );
};

GraphPage.getLayout = getGraphLayout;

export default GraphPage;
