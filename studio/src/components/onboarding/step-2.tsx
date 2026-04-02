import { useCallback, useEffect, useReducer } from 'react';
import { useRouter } from 'next/router';
import { useQuery } from '@connectrpc/connect-query';
import { getFederatedGraphByName } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetFederatedGraphByNameResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CheckCircledIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';
import { FederationAnimation } from './federation-animation';
import { Button } from '../ui/button';
import { CLI } from '../ui/cli';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

function isDemoGraphReady(data: GetFederatedGraphByNameResponse | undefined): boolean {
  if (!data?.graph) return false;
  if (data.response?.code !== EnumStatusCode.OK) return false;
  const subgraphs = data.subgraphs ?? [];
  return subgraphs.some((s) => s.name === 'products') && subgraphs.some((s) => s.name === 'reviews');
}

function getDemoGraphStatus({
  data,
  isPolling,
  isError,
}: {
  data: GetFederatedGraphByNameResponse | undefined;
  isPolling: boolean;
  isError: boolean;
}): 'pending' | 'ok' | 'fail' | 'error' {
  if (isError) return 'error';
  if (isDemoGraphReady(data)) return 'ok';
  return isPolling ? 'pending' : 'fail';
}

function pollingReducer(state: { active: boolean; epoch: number }, action: { type: 'RESTART' | 'TIMEOUT' }) {
  switch (action.type) {
    case 'RESTART':
      return { active: true, epoch: state.epoch + 1 };
    case 'TIMEOUT':
      return { ...state, active: false };
  }
}

const StatusIcon = ({ status }: { status: 'pending' | 'ok' | 'fail' | 'error' }) => {
  switch (status) {
    case 'pending':
      return (
        <span className="relative -mt-[1px] flex size-6 shrink-0 items-center justify-center">
          <span className="absolute inline-flex size-3 animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex size-3 rounded-full bg-green-500" />
        </span>
      );
    case 'ok':
      return (
        <span className="-mt-[1px] flex size-6 shrink-0 items-center justify-center text-green-600 dark:text-green-400">
          <CheckCircledIcon className="size-5" />
        </span>
      );
    case 'error':
    case 'fail':
      return (
        <span className="-mt-[1px] flex size-6 shrink-0 items-center justify-center">
          <span className="inline-flex size-3 rounded-full bg-destructive" />
        </span>
      );
  }
};

const StatusText = ({ status, onRetry }: { status: 'pending' | 'ok' | 'fail' | 'error'; onRetry: () => void }) => {
  switch (status) {
    case 'pending':
      return (
        <p className="text-sm text-muted-foreground">
          Waiting for the supergraph to be composed from the{' '}
          <span className="font-medium text-foreground">products</span> and{' '}
          <span className="font-medium text-foreground">reviews</span> subgraphs.
        </p>
      );
    case 'ok':
      return (
        <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          Supergraph composed from the <span className="font-medium">products</span> and{' '}
          <span className="font-medium">reviews</span> subgraphs.
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoCircledIcon className="inline size-3.5 shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64">
              The <span className="font-medium">reviews</span> field is now part of the{' '}
              <span className="font-medium">Product</span> type, contributed by the{' '}
              <span className="font-medium">reviews</span> subgraph through federation.
            </TooltipContent>
          </Tooltip>
        </span>
      );
    case 'error':
      return (
        <p className="text-sm text-destructive">Could not reach the server. Check your connection and try again.</p>
      );
    case 'fail':
      return (
        <p className="text-sm text-destructive">
          Demo graph not found. Make sure the command completed successfully.{' '}
          <Button variant="link" className="h-auto p-0 text-sm text-destructive underline" onClick={onRetry}>
            Try again
          </Button>
        </p>
      );
  }
};

export const Step2 = () => {
  const { setStep, setSkipped } = useOnboarding();
  const router = useRouter();
  const [polling, dispatch] = useReducer(pollingReducer, { active: true, epoch: 0 });

  const restartPolling = useCallback(() => dispatch({ type: 'RESTART' }), []);

  useEffect(() => {
    setStep(2);
  }, [setStep]);

  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: 'TIMEOUT' }), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [polling.epoch]);

  const { data, isError } = useQuery(
    getFederatedGraphByName,
    { name: 'demo', namespace: 'default' },
    {
      refetchInterval: polling.active ? (query) => (isDemoGraphReady(query.state.data) ? false : 5_000) : false,
    },
  );

  const status = getDemoGraphStatus({ data, isPolling: polling.active, isError });

  return (
    <OnboardingContainer>
      <div className="mt-4 flex w-full flex-col gap-6 text-left">
        <div className="flex gap-3">
          <span className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            1
          </span>
          <p className="text-sm text-muted-foreground">
            Install the{' '}
            <a
              target="_blank"
              rel="noreferrer"
              href="https://cosmo-docs.wundergraph.com/cli/intro"
              className="text-primary"
            >
              wgc CLI
            </a>{' '}
            if you haven&apos;t already. Ensure Docker is installed as well.
          </p>
        </div>

        <div className="flex gap-3">
          <span className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            2
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm text-muted-foreground">Make sure you&apos;re logged in.</p>
            <CLI command="npx wgc auth login" />
          </div>
        </div>

        <div className="flex gap-3">
          <span className="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            3
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm text-muted-foreground">Create a demo federated graph with sample subgraphs.</p>
            <Tabs defaultValue="cli">
              <TabsList>
                <TabsTrigger value="cli">CLI</TabsTrigger>
                <TabsTrigger value="manual">Manual</TabsTrigger>
              </TabsList>
              <TabsContent value="cli" className="min-h-20">
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    Run this command to scaffold everything automatically.
                  </p>
                  <CLI command="npx wgc demo" />
                </div>
              </TabsContent>
              <TabsContent value="manual" className="min-h-20">
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    Clone the onboarding repository, create a federated graph and publish the plugins individually.
                  </p>
                  <CLI command="git clone https://github.com/wundergraph/cosmo-onboarding.git && cd cosmo-onboarding" />
                  <CLI command="npx wgc federated-graph create demo --namespace default --label-matcher graph=demo --routing-url http://localhost:3002/graphql" />
                  <CLI command="npx wgc router plugin publish plugins/products --namespace default --label graph=demo" />
                  <CLI command="npx wgc router plugin publish plugins/reviews --namespace default --label graph=demo" />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <div className="flex gap-3">
          <StatusIcon status={status} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <StatusText status={status} onRetry={restartPolling} />
          </div>
        </div>
      </div>

      <FederationAnimation status={status} />

      <OnboardingNavigation
        className="pt-2"
        onSkip={setSkipped}
        backHref="/onboarding/1"
        forward={{
          onClick: () => router.push('/onboarding/3'),
          disabled: status !== 'ok',
        }}
      />
    </OnboardingContainer>
  );
};
