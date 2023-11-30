import { useFireworks } from "@/hooks/use-fireworks";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { useChartData } from "@/lib/insights-helpers";
import { checkUserAccess, cn } from "@/lib/utils";
import {
  ChevronDoubleRightIcon,
  CommandLineIcon,
} from "@heroicons/react/24/outline";
import { useMutation } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { migrateFromApollo } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { FederatedGraph } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import copy from "copy-to-clipboard";
import { getTime, parseISO, subDays } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { SiApollographql } from "react-icons/si";
import { Line, LineChart, ResponsiveContainer, XAxis } from "recharts";
import { z } from "zod";
import { UserContext } from "./app-provider";
import { ComposeStatusMessage } from "./compose-status";
import { ComposeStatusBulb } from "./compose-status-bulb";
import { EmptyState } from "./empty-state";
import { Logo } from "./logo";
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
  isMigrating,
  setIsMigrating,
  setIsMigrationSuccess,
  setToken,
  isEmptyState,
}: {
  refetch: () => void;
  isMigrating: boolean;
  setIsMigrating: Dispatch<SetStateAction<boolean>>;
  setIsMigrationSuccess: Dispatch<SetStateAction<boolean>>;
  setToken: Dispatch<SetStateAction<string | undefined>>;
  isEmptyState?: boolean;
}) => {
  const router = useRouter();
  const { organizationSlug } = router.query;
  const migrate = !!router.query.migrate;

  const migrateInputSchema = z.object({
    apiKey: z
      .string()
      .min(1, { message: "API Key must contain at least 1 character." }),
    variantName: z
      .string()
      .min(1, { message: "Variant name must contain at least 1 character." }),
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

  const { toast } = useToast();

  const { mutate } = useMutation(migrateFromApollo.useMutation());

  const [open, setOpen] = useState(migrate || false);

  const onSubmit: SubmitHandler<MigrateInput> = (data) => {
    setIsMigrating(true);
    mutate(
      {
        apiKey: data.apiKey,
        variantName: data.variantName,
      },
      {
        onSuccess: (d) => {
          setOpen(false);
          if (
            d.response?.code === EnumStatusCode.OK ||
            d.response?.code === EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED
          ) {
            toast({
              description: "Successfully migrated the graph.",
              duration: 2000,
            });
            refetch();
            setIsMigrationSuccess(true);
            setToken(d.token);
          } else if (d.response?.details) {
            setIsMigrating(false);
            toast({ description: d.response.details, duration: 3000 });
          }
          router.replace(`/${organizationSlug}/graphs`);
        },
        onError: (error) => {
          toast({
            description: "Could not migrate the graph. Please try again.",
            duration: 3000,
          });
          setOpen(false);
          setIsMigrating(false);
          router.replace(`/${organizationSlug}/graphs`);
        },
      },
    );
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn({
          "flex justify-center": isEmptyState,
          "h-52": !isEmptyState,
        })}
      >
        <Card className="flex h-full flex-col justify-center gap-y-2 bg-transparent p-4 group-hover:border-ring dark:hover:border-input-active ">
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
        {!isMigrating ? (
          <>
            <DialogHeader>
              <DialogTitle>Migrate from Apollo</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-y-2">
              <p className="text-sm">
                The Graph API Key is the api key associated to the graph which
                has to be migrated and it should be obtained from Apollo Studio.
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
                Note: This key is not stored and only used to fetch the
                subgraphs.
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
              <div className="flex flex-col gap-y-2">
                <span className="text-sm font-semibold">
                  Graph Variant Name
                </span>
                <Input
                  className="w-full"
                  type="text"
                  {...register("variantName")}
                />
                {errors.variantName && (
                  <span className="px-2 text-xs text-destructive">
                    {errors.variantName.message}
                  </span>
                )}
              </div>

              <Button
                className="mt-2"
                type="submit"
                disabled={!isValid}
                variant="default"
              >
                Migrate
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-y-4 py-4">
            <div className="flex items-center justify-center gap-x-5">
              <SiApollographql className="h-10 w-10" />
              <ChevronDoubleRightIcon className="animation h-8 w-8" />
              <Logo width={50} height={50} />
            </div>
            <p className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-xl font-semibold text-transparent">
              Migrating...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const MigrationSuccess = () => {
  useFireworks(true);
  return null;
};

export const RunRouterCommand = ({
  open,
  setOpen,
  graphName,
  token,
  triggerLabel,
  triggerClassName,
  hint,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  graphName: string;
  token: string;
  triggerLabel?: string;
  triggerClassName?: string;
  hint?: string;
}) => {
  const dockerRunCommand = `docker run \\
  --name cosmo-router \\
  --rm \\
  -p 3002:3002 \\
  --add-host=host.docker.internal:host-gateway \\
  --platform=linux/amd64 \\
  -e FEDERATED_GRAPH_NAME="${graphName}" \\
  -e DEV_MODE=true \\
  -e LISTEN_ADDR=0.0.0.0:3002 \\
  -e GRAPH_API_TOKEN=${token} \\
  ghcr.io/wundergraph/cosmo/router:latest`;

  const [copyDockerCommand, setCopyDockerCommand] = useState(false);

  useEffect(() => {
    if (copyDockerCommand) {
      copy(dockerRunCommand);
      const to = setTimeout(setCopyDockerCommand, 1000, false);
      return () => clearTimeout(to);
    }
  }, [dockerRunCommand, copyDockerCommand]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerLabel && (
        <DialogTrigger className={triggerClassName} asChild={true}>
          <Button
            className="w-full"
            onClick={() => {
              setOpen(true);
            }}
          >
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Router Initiation</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-y-4 pt-2">
          <div>
            <p className="pb-2 text-sm">
              Use the below command to initiate the router.{" "}
              <Link
                href={docsBaseURL + "/router/deployment"}
                className="text-sm text-primary"
                target="_blank"
                rel="noreferrer"
              >
                Learn more
              </Link>
            </p>
            <div className="flex justify-between rounded border border-input bg-background p-4">
              <code className="whitespace-pre-wrap break-all rounded font-mono text-xs leading-normal text-muted-foreground">
                {dockerRunCommand}
              </code>
              <Button
                asChild={true}
                size="sm"
                variant="secondary"
                onClick={() => setCopyDockerCommand(true)}
                className="cursor-pointer"
              >
                <div>
                  {copyDockerCommand ? (
                    <FiCheck className="text-xs" />
                  ) : (
                    <FiCopy className="text-xs" />
                  )}
                </div>
              </Button>
            </div>
            {hint && (
              <p className="mt-2 text-xs text-muted-foreground">{`Hint: ${hint}`}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const Empty = ({
  refetch,
  setIsMigrationSuccess,
  setToken,
  isMigrating,
  setIsMigrating,
}: {
  refetch: () => void;
  setIsMigrationSuccess: Dispatch<SetStateAction<boolean>>;
  setToken: Dispatch<SetStateAction<string | undefined>>;
  isMigrating: boolean;
  setIsMigrating: Dispatch<SetStateAction<boolean>>;
}) => {
  const user = useContext(UserContext);

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
          {checkUserAccess({
            rolesToBe: ["admin", "developer"],
            userRoles: user?.currentOrganization.roles || [],
          }) && (
            <>
              <span className="text-sm font-bold">OR</span>
              <MigrationDialog
                refetch={refetch}
                setIsMigrationSuccess={setIsMigrationSuccess}
                isEmptyState={true}
                setToken={setToken}
                isMigrating={isMigrating}
                setIsMigrating={setIsMigrating}
              />
            </>
          )}
        </div>
      }
    />
  );
};

const GraphCard = ({ graph }: { graph: FederatedGraph }) => {
  const user = useContext(UserContext);
  const { data, ticks, domain, timeFormatter } = useChartData(
    7 * 24,
    graph.requestSeries.length > 0 ? graph.requestSeries : fallbackData,
  );

  const parsedURL = () => {
    try {
      if (!graph.routingURL) {
        return "No endpoint provided";
      }

      const { host, pathname } = new URL(graph.routingURL);
      return host + pathname;
    } catch {}
  };

  return (
    <Link
      href={`/${user?.currentOrganization?.slug}/graph/${graph.name}`}
      className="project-list-item group"
    >
      <Card className="flex h-full flex-col py-4 transition-all group-hover:border-input-active">
        <div className="pointer-events-none -mx-1.5 h-20 pb-6">
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

        <div className="mt-2 flex flex-1 flex-col items-start px-6">
          <div className="text-base font-semibold">{graph.name}</div>
          <p
            className={cn(
              "mb-4 truncate pt-1 text-xs text-gray-500 dark:text-gray-400",
              {
                italic: !graph.routingURL,
              },
            )}
          >
            {parsedURL()}
          </p>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger className="mt-auto text-sm">
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
                  isComposable={graph.isComposable}
                  lastUpdatedAt={graph.lastUpdatedAt}
                  subgraphsCount={graph.connectedSubgraphs}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
  const [token, setToken] = useState<string | undefined>();
  const [isMigrating, setIsMigrating] = useState(false);
  const user = useContext(UserContext);

  useEffect(() => {
    if (isMigrationSuccess) {
      const to = setTimeout(setIsMigrating, 1500, false);
      return () => clearTimeout(to);
    }
  }, [isMigrationSuccess]);

  if (!graphs || graphs.length === 0)
    return (
      <Empty
        refetch={refetch}
        setIsMigrationSuccess={setIsMigrationSuccess}
        setToken={setToken}
        isMigrating={isMigrating}
        setIsMigrating={setIsMigrating}
      />
    );

  return (
    <>
      {isMigrationSuccess && token && (
        <>
          <MigrationSuccess />
          <RunRouterCommand
            open={isMigrationSuccess}
            setOpen={setIsMigrationSuccess}
            graphName={graphs[graphs.length - 1].name}
            token={token}
            hint="The Graph API Token which is scoped to the migrated
                federated graph is generated. Please store it safely for future
                use."
          />
        </>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {graphs.map((graph, graphIndex) => {
          return <GraphCard key={graphIndex.toString()} graph={graph} />;
        })}
        {checkUserAccess({
          rolesToBe: ["admin", "developer"],
          userRoles: user?.currentOrganization.roles || [],
        }) && (
          <MigrationDialog
            refetch={refetch}
            setIsMigrationSuccess={setIsMigrationSuccess}
            setToken={setToken}
            isMigrating={isMigrating}
            setIsMigrating={setIsMigrating}
          />
        )}
      </div>
    </>
  );
};
