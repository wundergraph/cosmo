import { FederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { Empty } from "./federatedgraphs-table";
import { Line, LineChart, ResponsiveContainer, XAxis } from "recharts";
import { getTime, parseISO, subDays } from "date-fns";
import { ComposeStatusMessage } from "./compose-status";
import { TimeAgo } from "./time-ago";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useChartData } from "@/lib/insights-helpers";
import { Card } from "./ui/card";
import Link from "next/link";
import { ComposeStatusBulb } from "./compose-status-bulb";
import { UserContext } from "./app-provider";
import { useContext } from "react";

// this is required to render a blank line with LineChart
const fallbackData = [
  {
    timestamp: subDays(new Date(), 1),
    totalRequests: 0,
  },
  {
    timestamp: new Date(),
    totalRequests: 0,
  },
];

const GraphCard = ({ graph }: { graph: FederatedGraph }) => {
  const user = useContext(UserContext);
  const { data, ticks, domain, timeFormatter } = useChartData(
    7 * 24,
    graph.requestSeries.length > 0 ? graph.requestSeries : fallbackData
  );

  let urlObject: URL | undefined;
  try {
    urlObject = new URL(graph.routingURL);
  } catch (e) {
    console.error(e);
  }

  return (
    <Link
      href={`/${user?.organization?.slug}/graph/${graph.name}`}
      className="project-list-item group"
    >
      <Card className="py-4 group-hover:border-ring dark:group-hover:border-input">
        <div className="h-20 pb-6">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line
                type="monotone"
                dataKey="totalRequests"
                animationDuration={300}
                stroke="#0284C7"
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
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="px-6">
          <div className="mt-2 text-base font-semibold">{graph.name}</div>
          <p className="mb-4 truncate pt-1 text-xs text-gray-500 dark:text-gray-400">
            {urlObject ? urlObject.host + urlObject.pathname : graph.routingURL}
          </p>

          <dl className="grid grid-cols-1 gap-x-2 gap-y-4 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <dd className="font-bol mt-1 flex items-center space-x-2 text-sm">
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger>
                      <ComposeStatusBulb
                        validGraph={graph.isComposable && !!graph.lastUpdatedAt}
                        emptyGraph={!graph.lastUpdatedAt && !graph.isComposable}
                      />
                      <span className="ml-2">
                        {graph.lastUpdatedAt ? (
                          <TimeAgo
                            date={getTime(parseISO(graph.lastUpdatedAt))}
                            tooltip={false}
                          />
                        ) : (
                          "-"
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <ComposeStatusMessage
                        errors={graph.compositionErrors}
                        isComposable={graph.isComposable}
                        lastUpdatedAt={graph.lastUpdatedAt}
                        subgraphsCount={graph.connectedSubgraphs}
                      />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </dd>
            </div>
          </dl>
          <style global jsx>{`
            /* Enforce a cursor pointer on the sparkline */
            .project-list-item
              .recharts-responsive-container
              .recharts-wrapper {
              cursor: pointer !important;
            }
          `}</style>
        </div>
      </Card>
    </Link>
  );
};

export const FederatedGraphsCards = ({
  graphs,
}: {
  graphs?: FederatedGraph[];
}) => {
  if (!graphs || graphs.length === 0) return <Empty />;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {graphs.map((graph, graphIndex) => {
        return <GraphCard key={graphIndex.toString()} graph={graph} />;
      })}
    </div>
  );
};
