import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFireworks } from "@/hooks/use-fireworks";
import { SubmitHandler, useZodForm } from "@/hooks/use-form";
import { docsBaseURL } from "@/lib/constants";
import { formatMetric } from "@/lib/format-metric";
import { useChartData } from "@/lib/insights-helpers";
import { cn } from "@/lib/utils";
import {
  ChevronDoubleRightIcon,
  CommandLineIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";
import { Component2Icon } from "@radix-ui/react-icons";
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
import { LuSquareDot } from "react-icons/lu";
import { MdNearbyError } from "react-icons/md";
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
import { useMutation } from "@connectrpc/connect-query";
import { useCheckUserAccess } from "@/hooks/use-check-user-access";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

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
  const { namespace: { name: namespace } } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;
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

  const { mutate } = useMutation(migrateFromApollo);

  const [open, setOpen] = useState(migrate || false);

  const onSubmit: SubmitHandler<MigrateInput> = (data) => {
    setIsMigrating(true);
    mutate(
      {
        apiKey: data.apiKey,
        variantName: data.variantName,
        namespace,
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
        onError: (_) => {
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
          "min-h-[254px]": !isEmptyState,
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
  namespace,
  token,
  triggerLabel,
  triggerClassName,
  hint,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  graphName: string;
  namespace?: string;
  token?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  hint?: string;
}) => {
  const dockerRunCommand = `docker run \\
  --name cosmo-router \\
  --rm \\
  -p 3002:3002 \\
  --add-host=host.docker.internal:host-gateway \\
  --pull always \\
  -e DEV_MODE=true \\
  -e DEMO_MODE=true \\
  -e LISTEN_ADDR=0.0.0.0:3002 \\
  -e GRAPH_API_TOKEN=${token ? token : "<graph-api-token>"} \\
  ghcr.io/wundergraph/cosmo/router:latest`;

  const dockerRunCmdElement = (
    <div className="flex flex-col">
      <span>docker run \</span>
      <span>{`  --name cosmo-router \\`}</span>
      <span>{`  --rm \\`}</span>
      <span>{`  -p 3002:3002 \\`}</span>
      <span>{`  --add-host=host.docker.internal:host-gateway \\`}</span>
      <span>{`  -e pull=always \\`}</span>
      <span>{`  -e DEV_MODE=true \\`}</span>
      <span>{`  -e DEMO_MODE=true \\`}</span>
      <span>{`  -e LISTEN_ADDR=0.0.0.0:3002 \\`}</span>
      <span>
        <span>{`  -e GRAPH_API_TOKEN=`}</span>
        <span>
          {token ? (
            token
          ) : (
            <span className="font-bold text-secondary-foreground">
              {"<graph-api-token>"}
            </span>
          )}{" "}
          \
        </span>
      </span>
      <span>{`  ghcr.io/wundergraph/cosmo/router:latest`}</span>
    </div>
  );

  const createTokenCommand = `npx wgc router token create <name> ${
    namespace ? `-n ${namespace}` : ""
  } -g ${graphName}`;

  const [copyDockerCommand, setCopyDockerCommand] = useState(false);
  const [copyTokenCommand, setCopyTokenCommand] = useState(false);

  useEffect(() => {
    if (copyDockerCommand) {
      copy(dockerRunCommand);
      const to = setTimeout(setCopyDockerCommand, 1000, false);
      return () => clearTimeout(to);
    }
  }, [dockerRunCommand, copyDockerCommand]);

  useEffect(() => {
    if (copyTokenCommand) {
      copy(createTokenCommand);
      const to = setTimeout(setCopyTokenCommand, 1000, false);
      return () => clearTimeout(to);
    }
  }, [createTokenCommand, copyTokenCommand]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerLabel && (
        <DialogTrigger className={triggerClassName} asChild={true}>
          <Button
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
          {!token && (
            <div>
              <p className="pb-2 text-sm">
                {`1. Create a Graph API Token using the below command. `}
                <Link
                  href={docsBaseURL + "/cli/router/token/create"}
                  className="text-sm text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </Link>
              </p>
              <div className="flex items-center justify-between rounded border border-input bg-background p-4">
                <code className="break-word whitespace-pre-wrap rounded font-mono text-xs leading-normal text-muted-foreground">
                  {`npx wgc router token create `}
                  <span className="font-bold text-secondary-foreground">
                    {"<name>"}
                  </span>
                  {` ${namespace ? `-n ${namespace}` : ""} -g ${graphName}`}
                </code>
                <Button
                  asChild={true}
                  size="sm"
                  variant="secondary"
                  onClick={() => setCopyTokenCommand(true)}
                  className="cursor-pointer"
                >
                  <div>
                    {copyTokenCommand ? (
                      <FiCheck className="text-xs" />
                    ) : (
                      <FiCopy className="text-xs" />
                    )}
                  </div>
                </Button>
              </div>
            </div>
          )}
          <div>
            <p className="pb-2 text-sm">
              {token
                ? "Use the below command to initiate the router. "
                : `2. Pass the token as GRAPH_API_TOKEN and run the below command to initiate the
              router. `}
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
                {dockerRunCmdElement}
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
  const checkUserAccess = useCheckUserAccess();
  const { namespace: { name: namespace } } = useWorkspace();

  let labels = "team=A";
  return (
    <EmptyState
      className="h-auto"
      icon={<CommandLineIcon />}
      title="No graphs found"
      description={
        <>
          Use the CLI tool to create either a federated graph ({" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/federated-graph/create"}
            className="text-primary"
          >
            docs
          </a>{" "}
          ) or a monograph ({" "}
          <a
            target="_blank"
            rel="noreferrer"
            href={docsBaseURL + "/cli/monograph/create"}
            className="text-primary"
          >
            docs
          </a>{" "}
          ).
        </>
      }
      actions={
        <div className="flex flex-col gap-y-6">
          <Tabs defaultValue="federated" className="mt-8 w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="federated">Federated Graph</TabsTrigger>
              <TabsTrigger value="monograph">Monograph</TabsTrigger>
            </TabsList>
            <TabsContent value="federated">
              <CLI
                command={`npx wgc federated-graph create production --namespace ${namespace} --label-matcher ${labels} --routing-url http://localhost:3002/graphql`}
              />
            </TabsContent>
            <TabsContent value="monograph">
              <CLI
                command={`npx wgc monograph create production --namespace ${namespace} --routing-url http://localhost:3002/graphql  --graph-url http://localhost:4000/graphql`}
              />
            </TabsContent>
          </Tabs>

          {checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] }) && (
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
    4,
    graph.requestSeries.length > 0 ? graph.requestSeries : fallbackData,
  );

  const totalRequests = graph.requestSeries.reduce(
    (total, r) => total + r.totalRequests,
    0,
  );

  const totalErrors = graph.requestSeries.reduce(
    (total, r) => total + r.erroredRequests,
    0,
  );

  const parsedURL = () => {
    try {
      if (!graph.routingURL) {
        return "No endpoint provided";
      }

      const { host, pathname } = new URL(graph.routingURL);
      return host + (pathname === "/" ? "" : pathname);
    } catch {}
  };

  return (
    <Link
      href={`/${user?.currentOrganization?.slug}/${graph.namespace}/graph/${graph.name}`}
      className="project-list-item group"
    >
      <Card className="flex h-full flex-col py-4 transition-all group-hover:border-input-active">
        <div className="pointer-events-none -mx-1.5 h-20 pb-4">
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
        <div className="flex w-full justify-end px-4 font-mono text-xs text-muted-foreground">
          {`${formatMetric(totalRequests / (4 * 60))} RPM`}
        </div>

        <div className="mt-3 flex flex-1 flex-col items-start px-6">
          <div className="text-base font-semibold">{graph.name}</div>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <p
                className={cn(
                  "w-full truncate pt-1 text-xs text-gray-500 dark:text-gray-400",
                  {
                    italic: !graph.routingURL,
                  },
                )}
              >
                {parsedURL()}
              </p>
            </TooltipTrigger>
            <TooltipContent>{parsedURL()}</TooltipContent>
          </Tooltip>
          <div className="mb-3 mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-x-2">
              {graph.supportsFederation ? (
                <Component2Icon className="h-4 w-4 text-[#0284C7]" />
              ) : (
                <LuSquareDot className="h-4 w-4 text-[#0284C7]" />
              )}
              {graph.supportsFederation ? (
                <p className="text-sm">
                  {`${formatMetric(graph.connectedSubgraphs)} ${
                    graph.connectedSubgraphs === 1 ? "subgraph" : "subgraphs"
                  }`}
                </p>
              ) : (
                <p className="text-sm">monograph</p>
              )}
            </div>

            <TooltipProvider>
              <Tooltip delayDuration={100}>
                <TooltipTrigger>
                  <div className="flex items-center gap-x-2">
                    <MdNearbyError className="h-4 w-4 text-destructive" />
                    <p className="text-sm">{`${formatMetric(totalErrors)} ${
                      totalErrors === 1 ? "error" : "errors"
                    }`}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{`${totalErrors} errors in the last 4 hours.`}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {graph.contract && (
              <div className="flex items-center gap-x-2 text-sm">
                <DocumentArrowDownIcon className="h-4 w-4 text-primary" />
                Contract
              </div>
            )}
          </div>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger className="flex items-start text-xs">
                <div className="flex h-4 w-4 items-center justify-center">
                  <ComposeStatusBulb
                    validGraph={graph.isComposable && !!graph.lastUpdatedAt}
                    emptyGraph={!graph.lastUpdatedAt && !graph.isComposable}
                  />
                </div>

                <p className="ml-1 text-left text-muted-foreground">
                  {graph.lastUpdatedAt ? (
                    <>
                      Schema last updated{" "}
                      <TimeAgo
                        date={getTime(parseISO(graph.lastUpdatedAt))}
                        tooltip={false}
                      />
                    </>
                  ) : (
                    "Not ready"
                  )}
                </p>
              </TooltipTrigger>
              <TooltipContent>
                <ComposeStatusMessage
                  isComposable={graph.isComposable}
                  lastUpdatedAt={graph.lastUpdatedAt}
                  subgraphsCount={graph.connectedSubgraphs}
                  isContract={!!graph.contract}
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
  const checkUserAccess = useCheckUserAccess();

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
        {checkUserAccess({ rolesToBe: ["organization-admin", "organization-developer"] }) && (
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
