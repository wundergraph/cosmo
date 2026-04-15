import { motion } from 'framer-motion';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { useFireworks } from '@/hooks/use-fireworks';
import { usePostHog } from 'posthog-js/react';
import { captureOnboardingEvent } from '@/lib/track';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';
import { StatusIcon, type OnboardingStatus } from './status-icon';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import {
  finishOnboarding,
  getFederatedGraphByName,
  getRouters,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GetFederatedGraphByNameResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useToast } from '../ui/use-toast';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { CLI } from '../ui/cli';
import { Kbd } from '../ui/kbd';
import { CheckCircledIcon } from '@radix-ui/react-icons';
import { Button } from '../ui/button';
import { MetricsMonitor } from './metrics-monitor';
import { StepFinished } from './step-finished';

const DEFAULT_ROUTING_URL = 'http://localhost:3002';

const DEMO_QUERY = `query GetProductWithReviews($id: ID!) {
  product(id: $id) {
    id
    title
    price {
      currency
      amount
    }
    reviews {
      id
      author
      rating
      contents
    }
  }
}`;
const DEMO_VARIABLES = '{"id":"product-1"}';

const stripWhitespace = (query: string): string => query.replace(/\s+/g, ' ').trim();

const buildCurlCommand = (routingUrl: string) =>
  `curl -s -X POST ${routingUrl} -H 'Content-Type: application/json' -d '{"query":"${stripWhitespace(DEMO_QUERY)}","variables":${DEMO_VARIABLES}}'`;

function pollingReducer(
  state: {
    routerTimedOut: boolean;
    metricsTimedOut: boolean;
    metricsEpoch: number;
  },
  action: { type: 'ROUTER_TIMEOUT' | 'METRICS_TIMEOUT' | 'RESTART_METRICS' },
) {
  switch (action.type) {
    case 'ROUTER_TIMEOUT':
      return { ...state, routerTimedOut: true };
    case 'METRICS_TIMEOUT':
      return { ...state, metricsTimedOut: true };
    case 'RESTART_METRICS':
      return { ...state, metricsTimedOut: false, metricsEpoch: state.metricsEpoch + 1 };
  }
}

function hasMetricsToday(data: GetFederatedGraphByNameResponse | undefined): boolean {
  if (!data?.graph) return false;
  const now = new Date();
  return data.graph.requestSeries.some((s) => {
    if (s.totalRequests <= 0) return false;
    const d = new Date(s.timestamp);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });
}

function getMetricsStatus({
  hasMetrics,
  hasGraph,
  isPolling,
  hasPolled,
}: {
  hasMetrics: boolean;
  hasGraph: boolean;
  isPolling: boolean;
  hasPolled: boolean;
}): OnboardingStatus {
  if (hasMetrics) return 'ok';
  if (!hasGraph) return isPolling || !hasPolled ? 'pending' : 'fail';
  return isPolling || !hasPolled ? 'pending' : 'fail';
}

const MetricsStatusText = ({ status, onRetry }: { status: OnboardingStatus; onRetry: () => void }) => {
  switch (status) {
    case 'pending':
      return (
        <p className="text-sm text-muted-foreground">
          Waiting for metrics to arrive. This may take a few minutes after sending a query.
        </p>
      );
    case 'ok':
      return <span className="text-sm text-success">Metrics received — your graph is reporting live traffic.</span>;
    case 'error':
    case 'fail':
      return (
        <p className="text-sm text-destructive">
          Metrics not detected. Make sure you sent a query and the router is running.{' '}
          <Button variant="link" className="h-auto p-0 text-sm text-destructive underline" onClick={onRetry}>
            Try again
          </Button>
        </p>
      );
  }
};

export const Step3 = () => {
  const [isFinished, setIsFinished] = useState(false);
  const { toast } = useToast();
  const { setStep, setSkipped, setOnboarding } = useOnboarding();
  const currentOrg = useCurrentOrganization();
  const posthog = usePostHog();

  const [polling, dispatch] = useReducer(pollingReducer, {
    routerTimedOut: false,
    metricsTimedOut: false,
    metricsEpoch: 0,
  });

  const restartMetricsPolling = () => dispatch({ type: 'RESTART_METRICS' });

  const { data: routersData } = useQuery(
    getRouters,
    { fedGraphName: 'demo', namespace: 'default' },
    {
      refetchInterval: polling.routerTimedOut
        ? false
        : (query) => ((query.state.data?.routers?.length ?? 0) > 0 ? false : 5_000),
    },
  );

  const hasActiveRouter = (routersData?.routers?.length ?? 0) > 0;
  const routerPolling = !hasActiveRouter && !polling.routerTimedOut;

  const { data: graphData } = useQuery(
    getFederatedGraphByName,
    { name: 'demo', namespace: 'default', includeMetrics: true },
    {
      refetchInterval:
        !hasActiveRouter || polling.metricsTimedOut
          ? false
          : (query) => (hasMetricsToday(query.state.data) ? false : 10_000),
    },
  );

  const hasMetrics = hasMetricsToday(graphData);
  const metricsPolling = hasActiveRouter && !hasMetrics && !polling.metricsTimedOut;
  const routingUrl = graphData?.graph?.routingURL || DEFAULT_ROUTING_URL;
  const curlCommand = useMemo(() => buildCurlCommand(routingUrl), [routingUrl]);
  const port = useMemo(() => {
    try {
      return new URL(routingUrl).port || '3002';
    } catch {
      return '3002';
    }
  }, [routingUrl]);

  const metricsStatus = getMetricsStatus({
    hasMetrics,
    hasGraph: !!graphData?.graph,
    isPolling: metricsPolling,
    hasPolled: hasActiveRouter,
  });

  useFireworks(metricsStatus === 'ok');

  useEffect(() => {
    if (!routerPolling) return;
    const timer = setTimeout(() => dispatch({ type: 'ROUTER_TIMEOUT' }), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [routerPolling]);

  useEffect(() => {
    if (!metricsPolling) return;
    const timer = setTimeout(() => dispatch({ type: 'METRICS_TIMEOUT' }), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [metricsPolling, polling.metricsEpoch]);

  useEffect(() => {
    setStep(3);
  }, [setStep]);

  useEffect(() => {
    setStep(3);
  }, [setStep]);

  const { mutate, isPending } = useMutation(finishOnboarding, {
    onSuccess: (d) => {
      if (d.response?.code !== EnumStatusCode.OK) {
        toast({
          description: d.response?.details ?? 'We had issues with finishing the onboarding. Please try again.',
          duration: 3000,
        });
        return;
      }

      setOnboarding((prev) => ({
        ...prev,
        finishedAt: new Date(d.finishedAt),
        federatedGraphsCount: d.federatedGraphsCount,
        slack: Boolean(prev?.slack),
        email: Boolean(prev?.email),
      }));

      captureOnboardingEvent(posthog, {
        name: 'onboarding_step_completed',
        options: {
          step_name: 'run_router_send_metrics',
        },
      });
      setIsFinished(true);
    },
    onError: (error) => {
      toast({
        description: error.details.toString() ?? 'We had issues with finishing the onboarding. Please try again.',
        duration: 3000,
      });
    },
  });

  return (
    <div className="relative w-full" style={{ perspective: '1600px' }}>
      <motion.div
        className="grid w-full [&>*]:col-start-1 [&>*]:row-start-1"
        animate={{ rotateY: isFinished ? 180 : 0 }}
        transition={{ duration: 0.7, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', minHeight: 788 }}
      >
        <div
          className="flex min-h-[788px] flex-col rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'translateZ(1px)',
          }}
          aria-hidden={isFinished}
        >
          <OnboardingContainer>
            <div className="mt-4 flex w-full flex-col gap-4 text-left">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Run your services</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start the router and send your first query to see live traffic in action.
                </p>
              </div>

              <div className="flex gap-3">
                <span className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  1
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Start the router</p>
                    {hasActiveRouter ? (
                      <span className="flex items-center gap-1.5 text-xs text-success">
                        <CheckCircledIcon className="size-3.5" />
                        Connected
                      </span>
                    ) : routerPolling ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="relative flex size-3.5 items-center justify-center">
                          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-success opacity-75" />
                          <span className="relative inline-flex size-2 rounded-full bg-success" />
                        </span>
                        Waiting…
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-destructive">
                        <span className="inline-flex size-2 rounded-full bg-destructive" />
                        Not detected
                      </span>
                    )}
                  </div>
                  <Tabs defaultValue="demo">
                    <TabsList>
                      <TabsTrigger value="demo">CLI</TabsTrigger>
                      <TabsTrigger value="manual">Manual</TabsTrigger>
                    </TabsList>
                    <TabsContent value="demo" className="min-h-28">
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-muted-foreground">
                          If you ran{' '}
                          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npx wgc demo</code> in the
                          previous step, the router is already running. Otherwise, re-run the command:
                        </p>
                        <CLI command="npx wgc demo" />
                      </div>
                    </TabsContent>
                    <TabsContent value="manual" className="min-h-28">
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-muted-foreground">
                          Generate a router token and start the router with Docker.
                        </p>
                        <CLI command="export GRAPH_API_TOKEN=$(npx wgc router token create demo-token --graph-name demo --namespace default --raw)" />
                        <CLI
                          command={`docker run --rm -p ${port}:${port} --add-host=host.docker.internal:host-gateway --pull always -e GRAPH_API_TOKEN=$GRAPH_API_TOKEN -e DEV_MODE=true -e PLUGINS_ENABLED=true -e LISTEN_ADDR=0.0.0.0:${port} ghcr.io/wundergraph/cosmo/router:latest`}
                        />
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>

              <div className="flex gap-3">
                <span className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  2
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="text-sm font-semibold">Send a test query</p>
                  <Tabs defaultValue="demo-query">
                    <TabsList>
                      <TabsTrigger value="demo-query">CLI</TabsTrigger>
                      <TabsTrigger value="curl">cURL</TabsTrigger>
                      <TabsTrigger value="playground">Playground</TabsTrigger>
                    </TabsList>
                    <TabsContent value="demo-query" className="min-h-24">
                      <p className="text-sm text-muted-foreground">
                        While <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npx wgc demo</code> is
                        running, press <Kbd>r</Kbd> in the terminal to send a test query.
                      </p>
                    </TabsContent>
                    <TabsContent value="curl" className="min-h-24">
                      <div className="flex flex-col gap-2">
                        <CLI command={curlCommand} />
                      </div>
                    </TabsContent>
                    <TabsContent value="playground" className="min-h-24">
                      <p className="text-sm text-muted-foreground">
                        Open the{' '}
                        <a
                          href={`/${currentOrg?.slug}/default/graph/demo/playground?operation=${encodeURIComponent(DEMO_QUERY)}&variables=${encodeURIComponent(DEMO_VARIABLES)}`}
                          className="text-primary"
                        >
                          Playground
                        </a>{' '}
                        to explore the schema and run queries interactively.
                      </p>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>

              <div className="-mt-2 flex flex-col gap-3">
                <div className="flex gap-3">
                  <StatusIcon status={metricsStatus} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <MetricsStatusText status={metricsStatus} onRetry={restartMetricsPolling} />
                  </div>
                </div>

                <MetricsMonitor status={metricsStatus} />
              </div>
            </div>

            <OnboardingNavigation
              className="pt-2"
              onSkip={() => {
                captureOnboardingEvent(posthog, {
                  name: 'onboarding_skipped',
                  options: {
                    step_name: 'run_router_send_metrics',
                  },
                });
                setSkipped();
              }}
              backHref="/onboarding/2"
              forward={{
                onClick: () => mutate({}),
                isLoading: isPending,
                disabled: metricsStatus !== 'ok',
              }}
              forwardLabel="Finish"
            />
          </OnboardingContainer>
        </div>
        <div
          className="flex min-h-[788px] flex-col rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg) translateZ(1px)',
          }}
          aria-hidden={!isFinished}
        >
          <StepFinished />
        </div>
      </motion.div>
    </div>
  );
};
