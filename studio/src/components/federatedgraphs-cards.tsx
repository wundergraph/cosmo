import { useFireworks } from "@/hooks/use-fireworks";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { useChartData } from "@/lib/insights-helpers";
import {
  ChevronDoubleRightIcon,
  CommandLineIcon,
} from "@heroicons/react/24/outline";
import { useMutation } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common_pb";
import { migrateFromApollo } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { FederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { getTime, parseISO, subDays } from "date-fns";
import Link from "next/link";
import { Dispatch, SetStateAction, useContext, useState } from "react";
import { Line, LineChart, ResponsiveContainer, XAxis } from "recharts";
import { z } from "zod";
import { UserContext } from "./app-provider";
import { ComposeStatusMessage } from "./compose-status";
import { ComposeStatusBulb } from "./compose-status-bulb";
import { EmptyState } from "./empty-state";
import { TimeAgo } from "./time-ago";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { CLI } from "./ui/cli";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useToast } from "./ui/use-toast";
import { Logo } from "./logo";
import { SiApollographql } from "react-icons/si";
import { cn } from "@/lib/utils";

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

const MigrationDialog = ({
  refetch,
  setIsMigrationSuccess,
  isEmptyState,
}: {
  refetch: () => void;
  setIsMigrationSuccess: Dispatch<SetStateAction<boolean>>;
  isEmptyState?: boolean;
}) => {
  const migrateInputSchema = z.object({
    apiKey: z
      .string()
      .min(1, { message: "API Key must contain at least 1 character." }),
  });

  type MigrateInput = z.infer<typeof migrateInputSchema>;

  const {
    register,
    formState: { isValid, errors },
    handleSubmit,
    reset,
  } = useZodForm<MigrateInput>({
    mode: "onBlur",
    schema: migrateInputSchema,
  });

  const { toast, update } = useToast();

  const { mutate, isLoading } = useMutation(migrateFromApollo.useMutation());
  const [open, setOpen] = useState(false);

  const onSubmit: SubmitHandler<MigrateInput> = (data) => {
    const { id } = toast({
      description: "Migrating the graph...",
    });
    mutate(
      {
        apiKey: data.apiKey,
      },
      {
        onSuccess: (d) => {
          if (
            d.response?.code === EnumStatusCode.OK ||
            d.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
          ) {
            update({
              description: "Successfully migrated the graph.",
              duration: 3000,
              id: id,
            });
            refetch();
            setIsMigrationSuccess(true);
          } else if (d.response?.details) {
            update({ description: d.response.details, duration: 3000, id: id });
          }
        },
        onError: (error) => {
          update({
            description: "Could not migrate the graph. Please try again.",
            duration: 3000,
            id: id,
          });
        },
      }
    );
    reset();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn({
          "flex justify-center": isEmptyState,
          "h-52": !isEmptyState,
        })}
      >
        <Card className="flex h-full w-64 flex-col justify-center gap-y-2  p-4 group-hover:border-ring dark:hover:border-input">
          <div className="flex items-center justify-center gap-x-5">
            <SiApollographql className="h-10 w-10" />
            <ChevronDoubleRightIcon className="animation h-8 w-8" />
            <Logo width={50} height={50} />
          </div>
          <p className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-xl font-semibold text-transparent">
            Migrate from Apollo
          </p>
        </Card>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Migrate from Apollo</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-y-2">
          <p className="text-sm">
            The Graph API Key is the api key associated to the graph which has
            to be migrated and it should be obtained from Apollo Studio.
          </p>
          <p className="text-sm">
            Click{" "}
            <Link
              href={docsBaseURL + "/studio/migrate-from-apollo"}
              className="text-primary"
              target="_blank"
              rel="noreferrer"
            >
              here
            </Link>{" "}
            to find the steps to obtain the key.
          </p>
          <p className="text-sm text-teal-400">
            Note: This key is not stored and only used to fetch the subgraphs.
          </p>
        </div>
        <form
          className="mt-2 flex flex-col gap-y-3"
          onSubmit={handleSubmit(onSubmit)}
        >
          <div className="flex flex-col gap-y-2">
            <span className="text-sm font-semibold">Graph API Key</span>
            <Input className="w-full" type="text" {...register("apiKey")} />
            {errors.apiKey && (
              <span className="px-2 text-xs text-destructive">
                {errors.apiKey.message}
              </span>
            )}
          </div>

          <Button
            className="mt-2"
            type="submit"
            disabled={!isValid}
            variant="default"
            isLoading={isLoading}
          >
            Migrate
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const MigrationSuccess = () => {
  useFireworks(true);
  return null;
};

export const Empty = ({
  refetch,
  setIsMigrationSuccess,
}: {
  refetch: () => void;
  setIsMigrationSuccess: Dispatch<SetStateAction<boolean>>;
}) => {
  let labels = "team=A";
  return (
    <EmptyState
      icon={<CommandLineIcon />}
      title="Create federated graph using CLI"
      description={
        <>
          No federated graphs found. Use the CLI tool to create one.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/federated-graphs/create"}
            className="text-primary"
          >
            Learn more.
          </a>
        </>
      }
      actions={
        <div className="flex flex-col gap-y-6">
          <CLI
            command={`npx wgc federated-graph create production --label-matcher ${labels} --routing-url http://localhost:4000/graphql`}
          />
          <span className="text-sm font-bold">OR</span>
          <MigrationDialog
            refetch={refetch}
            setIsMigrationSuccess={setIsMigrationSuccess}
            isEmptyState={true}
          />
        </div>
      }
    />
  );
};

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
  refetch,
}: {
  graphs?: FederatedGraph[];
  refetch: () => void;
}) => {
  const [isMigrationSuccess, setIsMigrationSuccess] = useState(false);

  if (!graphs || graphs.length === 0)
    return (
      <Empty refetch={refetch} setIsMigrationSuccess={setIsMigrationSuccess} />
    );

  return (
    <>
      {isMigrationSuccess && <MigrationSuccess />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {graphs.map((graph, graphIndex) => {
          return <GraphCard key={graphIndex.toString()} graph={graph} />;
        })}
        <MigrationDialog
          refetch={refetch}
          setIsMigrationSuccess={setIsMigrationSuccess}
        />
      </div>
    </>
  );
};
