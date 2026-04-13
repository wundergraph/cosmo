import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { useFireworks } from '@/hooks/use-fireworks';
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
import { motion } from 'framer-motion';
import { Step4Completed } from './step-4-completed';

const DEFAULT_ROUTING_URL = 'http://localhost:3002';

const DEMO_QUERY =
  'query GetProductWithReviews($id: ID!) { product(id: $id) { id title price { currency amount } reviews { id author rating contents } } }';
const DEMO_VARIABLES = '{"id":"product-1"}';

const buildCurlCommand = (routingUrl: string) =>
  `curl -s -X POST ${routingUrl}/graphql -H 'Content-Type: application/json' -d '{"query":"${DEMO_QUERY}","variables":${DEMO_VARIABLES}}'`;

function getMetricsStatus({
  data,
  isPolling,
  hasPolled,
}: {
  data: GetFederatedGraphByNameResponse | undefined;
  isPolling: boolean;
  hasPolled: boolean;
}): OnboardingStatus {
  if (!data?.graph) return isPolling || !hasPolled ? 'pending' : 'fail';
  const now = new Date();
  const hasRequests = data.graph.requestSeries.some((s) => {
    if (s.totalRequests <= 0) return false;
    const d = new Date(s.timestamp);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });
  if (hasRequests) return 'ok';
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
      return (
        <span className="text-sm text-green-600 dark:text-green-400">
          Metrics received — your graph is reporting live traffic.
        </span>
      );
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

export const Step4 = () => {
  const { toast } = useToast();
  const { setStep, setSkipped, setOnboarding } = useOnboarding();
  const currentOrg = useCurrentOrganization();

  const [isFinished, setIsFinished] = useState(false);
  const [isPolling, setIsPolling] = useState(true);
  const [isMetricsPolling, setIsMetricsPolling] = useState(false);
  const [hasMetricsPolled, setHasMetricsPolled] = useState(false);
  const [metricsPollingEpoch, setMetricsPollingEpoch] = useState(0);

  const restartMetricsPolling = useCallback(() => {
    setIsMetricsPolling(true);
    setHasMetricsPolled(true);
    setMetricsPollingEpoch((e) => e + 1);
  }, []);

  useEffect(() => {
    setStep(4);
  }, [setStep]);

  const { data: graphData } = useQuery(
    getFederatedGraphByName,
    { name: 'demo', namespace: 'default', includeMetrics: true },
    { refetchInterval: isMetricsPolling ? 10_000 : false },
  );

  const routingUrl = graphData?.graph?.routingURL || DEFAULT_ROUTING_URL;
  const port = useMemo(() => {
    try {
      return new URL(routingUrl).port || '3002';
    } catch {
      return '3002';
    }
  }, [routingUrl]);

  const { data: routersData } = useQuery(
    getRouters,
    { fedGraphName: 'demo', namespace: 'default' },
    { refetchInterval: isPolling ? 5_000 : false },
  );

  const hasActiveRouter = (routersData?.routers?.length ?? 0) > 0;

  const metricsStatus = getMetricsStatus({ data: graphData, isPolling: isMetricsPolling, hasPolled: hasMetricsPolled });

  useFireworks(metricsStatus === 'ok');

  useEffect(() => {
    if (hasActiveRouter) {
      setIsPolling(false);
      setIsMetricsPolling(true);
      setHasMetricsPolled(true);
    }
  }, [hasActiveRouter]);

  useEffect(() => {
    if (metricsStatus === 'ok') setIsMetricsPolling(false);
  }, [metricsStatus]);

  useEffect(() => {
    const timer = setTimeout(() => setIsPolling(false), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isMetricsPolling) return;
    const timer = setTimeout(() => setIsMetricsPolling(false), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isMetricsPolling, metricsPollingEpoch]);

  const curlCommand = useMemo(() => buildCurlCommand(routingUrl), [routingUrl]);

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
        className="relative w-full"
        animate={{ rotateY: isFinished ? 180 : 0 }}
        transition={{ duration: 0.7, ease: 'easeInOut' }}
        style={{ transformStyle: 'preserve-3d', minHeight: 788 }}
      >
        <div
          className="absolute inset-0 flex min-h-[788px] flex-col rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
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
                      <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                        <CheckCircledIcon className="size-3.5" />
                        Connected
                      </span>
                    ) : isPolling ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="relative flex size-3.5 items-center justify-center">
                          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex size-2 rounded-full bg-green-500" />
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
                    <TabsContent value="playground" className="min-h-36">
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
              onSkip={setSkipped}
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
          className="absolute inset-0 flex min-h-[788px] flex-col rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg) translateZ(1px)',
          }}
          aria-hidden={!isFinished}
        >
          <Step4Completed />
        </div>
      </motion.div>
    </div>
  );
};
