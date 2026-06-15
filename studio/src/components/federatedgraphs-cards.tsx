import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFireworks } from '@/hooks/use-fireworks';
import { docsBaseURL } from '@/lib/constants';
import { formatMetric } from '@/lib/format-metric';
import { useChartData } from '@/lib/insights-helpers';
import { cn } from '@/lib/utils';
import { CommandLineIcon, DocumentArrowDownIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { ArrowRightIcon, Component2Icon, LightningBoltIcon, PlayIcon } from '@radix-ui/react-icons';
import { FederatedGraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import copy from 'copy-to-clipboard';
import { getTime, parseISO, subDays } from 'date-fns';
import Link from 'next/link';
import { Dispatch, SetStateAction, useContext, useEffect, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';
import { LuSquareDot } from 'react-icons/lu';
import { MdNearbyError } from 'react-icons/md';
import { Line, LineChart, ResponsiveContainer, XAxis } from 'recharts';
import { UserContext } from './app-provider';
import { ComposeStatusMessage } from './compose-status';
import { ComposeStatusBulb } from './compose-status-bulb';
import { EmptyState } from './empty-state';
import { TimeAgo } from './time-ago';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { CLI } from './ui/cli';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { MigrationDialog } from './migration-dialog';
import { useCheckUserAccess } from '@/hooks/use-check-user-access';
import { useWorkspace } from '@/hooks/use-workspace';
import { useOnboarding } from '@/hooks/use-onboarding';

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
  -e GRAPH_API_TOKEN=${token ? token : '<graph-api-token>'} \\
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
          {token ? token : <span className="font-bold text-secondary-foreground">{'<graph-api-token>'}</span>} \
        </span>
      </span>
      <span>{`  ghcr.io/wundergraph/cosmo/router:latest`}</span>
    </div>
  );

  const createTokenCommand = `npx wgc router token create <name> ${namespace ? `-n ${namespace}` : ''} -g ${graphName}`;

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
                  href={docsBaseURL + '/cli/router/token/create'}
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
                  <span className="font-bold text-secondary-foreground">{'<name>'}</span>
                  {` ${namespace ? `-n ${namespace}` : ''} -g ${graphName}`}
                </code>
                <Button
                  asChild={true}
                  size="sm"
                  variant="secondary"
                  onClick={() => setCopyTokenCommand(true)}
                  className="cursor-pointer"
                >
                  <div>{copyTokenCommand ? <FiCheck className="text-xs" /> : <FiCopy className="text-xs" />}</div>
                </Button>
              </div>
            </div>
          )}
          <div>
            <p className="pb-2 text-sm">
              {token
                ? 'Use the below command to initiate the router. '
                : `2. Pass the token as GRAPH_API_TOKEN and run the below command to initiate the
              router. `}
              <Link
                href={docsBaseURL + '/router/deployment'}
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
                <div>{copyDockerCommand ? <FiCheck className="text-xs" /> : <FiCopy className="text-xs" />}</div>
              </Button>
            </div>
            {hint && <p className="mt-2 text-xs text-muted-foreground">{`Hint: ${hint}`}</p>}
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
  const {
    namespace: { name: namespace },
  } = useWorkspace();

  const { onboarding, enabled, currentStep } = useOnboarding();
  const displayOnboardingEmptyState = enabled && onboarding && onboarding.federatedGraphsCount === 0;

  let labels = 'team=A';
  return (
    <>
      {displayOnboardingEmptyState && (
        <OnboardingEmptyState step={currentStep} isFinished={Boolean(onboarding.finishedAt)} />
      )}
      <EmptyState
        className="h-auto"
        icon={displayOnboardingEmptyState ? undefined : <CommandLineIcon />}
        title={displayOnboardingEmptyState ? undefined : 'No graphs found'}
        description={
          displayOnboardingEmptyState ? undefined : (
            <>
              Use the CLI tool to create either a federated graph ({' '}
              <a
                target="_blank"
                rel="noreferrer"
                href={docsBaseURL + '/cli/federated-graph/create'}
                className="text-primary"
              >
                docs
              </a>{' '}
              ) or a monograph ({' '}
              <a target="_blank" rel="noreferrer" href={docsBaseURL + '/cli/monograph/create'} className="text-primary">
                docs
              </a>{' '}
              ).
            </>
          )
        }
        actions={
          <div className="flex flex-col gap-y-6">
            <Tabs
              defaultValue="federated"
              className={cn('w-full', {
                'mt-8': !displayOnboardingEmptyState,
              })}
            >
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

            {checkUserAccess({ rolesToBe: ['organization-admin', 'organization-developer'] }) && (
              <>
                {displayOnboardingEmptyState ? (
                  <OnboardingOrSeparator className="my-4" />
                ) : (
                  <span className="text-sm font-bold">OR</span>
                )}
                <MigrationDialog
                  refetch={refetch}
                  setIsMigrationSuccess={setIsMigrationSuccess}
                  isEmptyState={true}
                  compact={displayOnboardingEmptyState}
                  setToken={setToken}
                  isMigrating={isMigrating}
                  setIsMigrating={setIsMigrating}
                />
              </>
            )}
          </div>
        }
      />
    </>
  );
};

const GraphCard = ({ graph, hasStaleMetrics }: { graph: FederatedGraph; hasStaleMetrics: boolean }) => {
  const user = useContext(UserContext);
  const { data, ticks, domain, timeFormatter } = useChartData(
    4,
    graph.requestSeries.length > 0 ? graph.requestSeries : fallbackData,
  );

  const totalRequests = graph.requestSeries.reduce((total, r) => total + r.totalRequests, 0);

  const totalErrors = graph.requestSeries.reduce((total, r) => total + r.erroredRequests, 0);

  const parsedURL = () => {
    try {
      if (!graph.routingURL) {
        return 'No endpoint provided';
      }

      const { host, pathname } = new URL(graph.routingURL);
      return host + (pathname === '/' ? '' : pathname);
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
                stroke={hasStaleMetrics ? 'hsl(var(--gray-100))' : '#0284C7'}
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
        {hasStaleMetrics ? (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <div
                className="flex w-full items-center justify-end gap-1 px-4 font-mono text-xs text-gray-100"
                tabIndex={0}
                role="img"
                aria-label="Analytics are not available at this moment"
              >
                <ExclamationTriangleIcon width={12} height={12} aria-hidden />
                N/A
              </div>
            </TooltipTrigger>
            <TooltipContent>Analytics are not available at this moment</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex w-full justify-end px-4 font-mono text-xs text-muted-foreground">
            {`${formatMetric(totalRequests / (4 * 60))} RPM`}
          </div>
        )}

        <div className="mt-3 flex flex-1 flex-col items-start px-6">
          <div className="text-base font-semibold">{graph.name}</div>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <p
                className={cn('w-full truncate pt-1 text-xs text-gray-500 dark:text-gray-400', {
                  italic: !graph.routingURL,
                })}
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
                    graph.connectedSubgraphs === 1 ? 'subgraph' : 'subgraphs'
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
                      totalErrors === 1 ? 'error' : 'errors'
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
                      Schema last updated <TimeAgo date={getTime(parseISO(graph.lastUpdatedAt))} tooltip={false} />
                    </>
                  ) : (
                    'Not ready'
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

function OnboardingBoltIcon() {
  return <LightningBoltIcon className="size-10 text-primary" />;
}

function OnboardingOrSeparator({ className }: { className?: string }) {
  return (
    <div className={cn('mt-7 flex w-full items-center gap-4', className)}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs font-bold text-muted-foreground">OR</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function OnboardingEmptyState({ step, isFinished }: { step?: number; isFinished: boolean }) {
  const shouldContinue = step !== undefined && !isFinished;

  return (
    <div className="flex w-full max-w-2xl flex-col items-center px-6 text-center">
      <OnboardingBoltIcon />
      <h3 className="mt-7 text-2xl font-bold tracking-tight">Create your first graph</h3>
      <p className="mt-4 text-sm text-muted-foreground">
        No graphs yet. Take the guided tour, or set one up from the CLI.
      </p>
      <Link
        href={`/onboarding/${shouldContinue ? step : 1}`}
        className="mt-5 flex w-full items-center rounded-xl bg-pink-600 px-5 py-4 text-left text-white transition-colors hover:bg-pink-700"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/20">
          <PlayIcon className="size-5" />
        </span>
        <span className="ml-4 min-w-0 flex-1">
          <span className="block text-base font-bold leading-5">
            {shouldContinue ? 'Continue the 5-minute tour' : 'Start the 5-minute tour'}
          </span>
          <span className="block text-sm leading-5 text-white/85">Set up your first federated graph step by step</span>
        </span>
        <ArrowRightIcon className="ml-4 size-5 shrink-0" />
      </Link>
      <OnboardingOrSeparator />
    </div>
  );
}

export const FederatedGraphsCards = ({
  graphs,
  refetch,
  hasStaleMetrics,
}: {
  graphs?: FederatedGraph[];
  refetch: () => void;
  hasStaleMetrics: boolean;
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
      <div className="flex flex-col items-center gap-y-8">
        <Empty
          refetch={refetch}
          setIsMigrationSuccess={setIsMigrationSuccess}
          setToken={setToken}
          isMigrating={isMigrating}
          setIsMigrating={setIsMigrating}
        />
      </div>
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
          return <GraphCard key={graphIndex.toString()} graph={graph} hasStaleMetrics={hasStaleMetrics} />;
        })}
        {checkUserAccess({ rolesToBe: ['organization-admin', 'organization-developer'] }) && (
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
