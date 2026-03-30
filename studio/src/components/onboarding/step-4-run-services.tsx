import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { useFireworks } from '@/hooks/use-fireworks';
import { CheckCircledIcon } from '@radix-ui/react-icons';
import { useMutation } from '@connectrpc/connect-query';
import { finishOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/router';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { Onboarding } from './onboarding-provider';

const METRICS_DELAY = 5000;

const CURL_COMMAND = `curl -s -X POST http://localhost:3002/graphql \\
  -H 'Content-Type: application/json' \\
  -d '{"query":"query GetProductWithReviews($id: ID!) { product(id: $id) { id title price { currency amount } reviews { id author rating contents } } }","variables":{"id":"product-1"}}'`;

const DOT_GRID_ROWS = 8;
const DOT_GRID_COLS = 12;

const CONFETTI_DURATION = 2000;

function DotGrid({ received }: { received: boolean }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${DOT_GRID_COLS}, 1fr)` }}>
      {Array.from({ length: DOT_GRID_ROWS * DOT_GRID_COLS }).map((_, i) => (
        <motion.div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20"
          animate={
            received
              ? { opacity: 1 }
              : {
                  opacity: [0.2, 0.6, 0.2],
                }
          }
          transition={
            received
              ? { duration: 0.3 }
              : {
                  duration: 2,
                  repeat: Infinity,
                  delay: (Math.floor(i / DOT_GRID_COLS) + (i % DOT_GRID_COLS)) * 0.08,
                }
          }
        />
      ))}
    </div>
  );
}

function MetricsAnimation({ received }: { received: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <AnimatePresence mode="wait">
          {received ? (
            <motion.div
              key="received"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2"
            >
              <CheckCircledIcon className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-green-600">Metrics received!</span>
            </motion.div>
          ) : (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <motion.div
                className="h-2 w-2 rounded-full bg-primary"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <span className="text-sm font-medium text-muted-foreground">Waiting for metrics...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <DotGrid received={received} />
    </div>
  );
}

interface Step4RunServicesProps {
  onDismiss: () => void;
  onSubmitSuccess: Dispatch<SetStateAction<Onboarding | undefined>>;
}

export function Step4RunServices({ onDismiss, onSubmitSuccess }: Step4RunServicesProps) {
  const router = useRouter();
  const org = useCurrentOrganization();
  const [metricsReceived, setMetricsReceived] = useState(false);
  const [mutationDone, setMutationDone] = useState(false);
  const [confettiDone, setConfettiDone] = useState(false);
  const hasMutated = useRef(false);
  const mutationResponse = useRef<Onboarding | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMetricsReceived(true);
    }, METRICS_DELAY);

    return () => clearTimeout(timer);
  }, []);

  const { mutate, isPending } = useMutation(finishOnboarding);

  // auto-trigger mutation when metrics are received
  useEffect(() => {
    if (!metricsReceived || hasMutated.current) return;
    hasMutated.current = true;

    mutate(
      {},
      {
        onSuccess(res) {
          if (res.response?.code === EnumStatusCode.OK && res.onboarding) {
            mutationResponse.current = {
              ...res.onboarding,
              createdAt: new Date(res.onboarding.createdAt),
              finishedAt: res.onboarding.finishedAt ? new Date(res.onboarding.finishedAt) : null,
              updatedAt: res.onboarding.updatedAt ? new Date(res.onboarding.updatedAt) : null,
              federatedGraphId: res.onboarding.federatedGraphId || undefined,
            };
          }
          setMutationDone(true);
        },
      },
    );
  }, [metricsReceived, mutate]);

  // trigger confetti after mutation completes
  useFireworks(mutationDone);

  // track confetti completion
  useEffect(() => {
    if (!mutationDone) return;
    const timer = setTimeout(() => setConfettiDone(true), CONFETTI_DURATION);
    return () => clearTimeout(timer);
  }, [mutationDone]);

  const navigateAway = useCallback(() => {
    if (!mutationDone) return;
    if (mutationResponse.current) {
      onSubmitSuccess(mutationResponse.current);
    }
    onDismiss();
    router.push(`/${org?.slug}/graphs`);
  }, [mutationDone, onDismiss, onSubmitSuccess, router, org?.slug]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Send your first query</h2>
        <p className="text-sm text-muted-foreground">
          Make sure <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">wgc demo</code> is still
          running from the previous step. Choose one of the options below to send a query.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              1
            </span>
            Press <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium">r</kbd> in the wgc demo
            terminal
          </h3>
          <p className="pl-7 text-xs text-muted-foreground">
            This triggers a sample GraphQL request directly from the running demo.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              2
            </span>
            Use cURL
          </h3>
          <div className="relative pl-7">
            <pre className="rounded-md bg-muted px-4 py-3 pr-10 font-mono text-xs">{CURL_COMMAND}</pre>
            <div className="absolute right-2 top-2">
              <CopyButton tooltip="Copy cURL command" value={CURL_COMMAND} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              3
            </span>
            Open the Playground
          </h3>
          <p className="pl-7 text-xs text-muted-foreground">
            <a
              href={`/${org?.slug}/default/graph/FEDERATED_GRAPH_ID/playground`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              Open Playground
            </a>{' '}
            to construct and run your own queries.
          </p>
        </div>
      </div>

      <MetricsAnimation received={metricsReceived} />

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={navigateAway} disabled={isPending || !confettiDone}>
          Skip
        </Button>
        <Button type="button" onClick={navigateAway} disabled={!confettiDone}>
          I&apos;m ready
        </Button>
      </div>
    </div>
  );
}
