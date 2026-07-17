import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFireworks } from '@/hooks/use-fireworks';
import { docsBaseURL } from '@/lib/constants';
import { formatDurationMetric, formatMetric } from '@/lib/format-metric';
import { formatNumber } from '@/lib/format-number';
import { useChartData } from '@/lib/insights-helpers';
import { cn } from '@/lib/utils';
import { CommandLineIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';
import { ArrowRightIcon, LightningBoltIcon, PlayIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getDashboardAnalyticsView,
  getFederatedGraphByName,
  getGraphMetrics,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { FederatedGraph } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import copy from 'copy-to-clipboard';
import { getTime, parseISO, subDays } from 'date-fns';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Dispatch, SetStateAction, useContext, useEffect, useMemo, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';
import { LuSquareDot } from 'react-icons/lu';
import { MdNearbyError } from 'react-icons/md';
import { Line, LineChart, ResponsiveContainer, XAxis } from 'recharts';
import { UserContext } from './app-provider';
import { ComposeStatusBulb } from './compose-status-bulb';
import { EmptyState } from './empty-state';
import { TimeAgo } from './time-ago';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { CLI } from './ui/cli';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MigrationDialog } from './migration-dialog';
import { useQuery } from '@connectrpc/connect-query';
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
  const router = useRouter();
  const { data, ticks, domain, timeFormatter } = useChartData(
    4,
    graph.requestSeries.length > 0 ? graph.requestSeries : fallbackData,
  );

  const totalRequests = graph.requestSeries.reduce((total, r) => total + r.totalRequests, 0);

  const totalErrors = graph.requestSeries.reduce((total, r) => total + r.erroredRequests, 0);
  const isReady = Boolean(graph.lastUpdatedAt);
  const isHealthy = totalErrors === 0;
  const errorRatePct = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const rpm = totalRequests / (4 * 60);
  const rpmLabel =
    totalRequests === 0
      ? formatNumber(0, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      : formatMetric(rpm);

  const { data: graphMetrics } = useQuery(
    getGraphMetrics,
    { namespace: graph.namespace, federatedGraphName: graph.name, range: 4 },
    { enabled: isReady, refetchOnWindowFocus: false },
  );

  const p95LatencyValue = Number.parseInt(graphMetrics?.latency?.value || '0');
  const p95LatencyLabel =
    isReady && graphMetrics?.response?.code === EnumStatusCode.OK && p95LatencyValue > 0
      ? formatDurationMetric(p95LatencyValue, { maximumFractionDigits: 3 })
      : 'N/A';
  const p95LatencyTone =
    p95LatencyLabel === 'N/A'
      ? 'muted'
      : p95LatencyValue >= 1000
        ? 'critical'
        : p95LatencyValue >= 500
          ? 'slow'
          : 'normal';

  const shouldFetchTopErrorSubgraph = isReady && !isHealthy && graph.supportsFederation;
  const { data: graphDetails } = useQuery(
    getFederatedGraphByName,
    { name: graph.name, namespace: graph.namespace },
    { enabled: shouldFetchTopErrorSubgraph, refetchOnWindowFocus: false },
  );
  const { data: dashboardView } = useQuery(
    getDashboardAnalyticsView,
    { namespace: graph.namespace, federatedGraphName: graph.name, range: 4 },
    { enabled: shouldFetchTopErrorSubgraph, refetchOnWindowFocus: false },
  );

  const topErrorSubgraphName = useMemo(() => {
    const subgraphMetrics = dashboardView?.subgraphMetrics ?? [];
    const subgraphs = graphDetails?.subgraphs ?? [];
    if (subgraphMetrics.length === 0 || subgraphs.length === 0) return undefined;

    const top = subgraphMetrics.reduce((best, next) => (next.errorRate > best.errorRate ? next : best), subgraphMetrics[0]);
    const match = subgraphs.find((s) => s.id === top.subgraphID);
    return match?.name;
  }, [dashboardView?.subgraphMetrics, graphDetails?.subgraphs]);

  const orgSlug = user?.currentOrganization?.slug;
  const graphBasePath = `/${orgSlug}/${graph.namespace}/graph/${graph.name}`;
  const topErrorSubgraphAnalyticsPath =
    topErrorSubgraphName && orgSlug
      ? `/${orgSlug}/${graph.namespace}/subgraph/${topErrorSubgraphName}/analytics?graph=${encodeURIComponent(graph.name)}`
      : undefined;

  const primaryCta = (() => {
    if (!orgSlug) return { label: 'View', href: graphBasePath };
    if (!isReady) return { label: 'View details', href: graphBasePath };
    if (!isHealthy) return { label: 'Investigate', href: topErrorSubgraphAnalyticsPath ?? `${graphBasePath}/analytics` };
    return { label: 'View', href: graphBasePath };
  })();

  const statusText = (() => {
    if (!isReady) return 'Waiting for first schema publish.';
    if (!isHealthy) return topErrorSubgraphName ? topErrorSubgraphName : 'Elevated errors';
    return 'All good.';
  })();

  const parsedURL = () => {
    try {
      if (!graph.routingURL) {
        return 'No endpoint provided';
      }

      const { host, pathname } = new URL(graph.routingURL);
      return host + (pathname === '/' ? '' : pathname);
    } catch {}
  };

  const endpointLabel = () => {
    const url = parsedURL();
    if (!url) return undefined;
    return url;
  };

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`View ${graph.name}`}
      className="project-list-item group cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() => {
        router.push(graphBasePath);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(graphBasePath);
        }
      }}
    >
      <Card className="flex h-full flex-col pt-4 pb-3 transition-all group-hover:border-input-active">
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
        <div className="mt-3 flex flex-1 flex-col items-start px-6">
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0 text-base font-semibold">{graph.name}</div>
            <Badge
              className="shrink-0 tracking-[0.44px]"
              variant={isHealthy ? 'success' : 'destructive'}
            >
              {isHealthy ? 'Healthy' : 'Degraded'}
            </Badge>
          </div>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <p
                className={cn('w-full truncate pt-1 text-xs text-gray-500 dark:text-gray-400', {
                  italic: !graph.routingURL,
                })}
              >
                {endpointLabel()}
              </p>
            </TooltipTrigger>
            <TooltipContent>{endpointLabel()}</TooltipContent>
          </Tooltip>

          <div className="mt-1 w-full text-xs text-muted-foreground">
            {graph.supportsFederation
              ? `${formatMetric(graph.connectedSubgraphs)} ${graph.connectedSubgraphs === 1 ? 'subgraph' : 'subgraphs'}`
              : 'monograph'}{' '}
            · updated{' '}
            {graph.lastUpdatedAt ? (
              <TimeAgo date={getTime(parseISO(graph.lastUpdatedAt))} tooltip={false} compact />
            ) : (
              'never'
            )}
          </div>

          <div className="mt-4 -mx-6 w-[calc(100%+3rem)] overflow-hidden border-y bg-muted/30 text-sm">
            <div className="grid grid-cols-3 divide-x divide-border">
              <div className="px-6 py-4">
                <div className="text-[12px] font-medium tracking-[0px] text-muted-foreground">ERROR RATE</div>
                <div
                  className={cn(
                    'mt-2 text-2xl font-semibold tabular-nums',
                    isHealthy ? 'text-[#6e677e] dark:text-muted-foreground' : 'text-destructive',
                  )}
                >
                  {`${errorRatePct.toFixed(0)}%`}
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[12px] font-medium tracking-[0px] text-muted-foreground">P95 LATENCY</div>
                <div
                  className={cn(
                    'mt-2 text-2xl font-semibold tabular-nums',
                    p95LatencyTone === 'muted' && 'text-muted-foreground',
                    p95LatencyTone === 'normal' && 'text-[#6e677e] dark:text-muted-foreground',
                    // Use a darker yellow in light mode for AA contrast.
                    p95LatencyTone === 'slow' && 'text-yellow-700 dark:text-yellow-500',
                    p95LatencyTone === 'critical' && 'text-destructive',
                  )}
                  style={p95LatencyTone === 'normal' ? { color: 'rgb(110, 103, 126)' } : undefined}
                >
                  {p95LatencyLabel}
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="text-[12px] font-medium tracking-[0px] text-muted-foreground">RPM</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-[#6e677e] dark:text-muted-foreground">
                  {rpmLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex w-full items-center justify-between gap-4 pb-1 text-sm">
            <div className={cn('flex min-w-0 items-center gap-2', isReady && !isHealthy && 'text-destructive')}>
              {isReady && !isHealthy ? (
                <MdNearbyError className="h-4 w-4 shrink-0" />
              ) : (
                <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <ComposeStatusBulb
                    validGraph={graph.isComposable && !!graph.lastUpdatedAt}
                    emptyGraph={!graph.lastUpdatedAt && !graph.isComposable}
                  />
                </div>
              )}

              <div className={cn('min-w-0 truncate', isReady && isHealthy && 'text-muted-foreground')}>
                {statusText}
                {isReady && !isHealthy && (
                  <span className="text-destructive">{` · ${errorRatePct.toFixed(0)}% error rate`}</span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="shrink-0 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(primaryCta.href);
              }}
            >
              {primaryCta.label}
            </button>
          </div>
        </div>
      </Card>
    </div>
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
