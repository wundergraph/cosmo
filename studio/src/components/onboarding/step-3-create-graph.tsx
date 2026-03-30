import { Button } from '@/components/ui/button';
import { docsBaseURL } from '@/lib/constants';
import { useCurrentOrganization } from '@/hooks/use-current-organization';
import { CheckCircledIcon, CubeIcon } from '@radix-ui/react-icons';
import { useMutation } from '@connectrpc/connect-query';
import { completeOnboardingStep3 } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { motion } from 'framer-motion';
import { useRouter } from 'next/router';
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { Onboarding } from './onboarding-provider';

const COMPOSITION_DURATION = 5000;

const subgraphs = [
  { name: 'Products', delay: 0 },
  { name: 'Reviews', delay: 0.3 },
];

function SubgraphNode({ name, delay }: { name: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay }}
      className="flex items-center gap-2 rounded-md border bg-card px-4 py-3 text-sm font-medium shadow-sm"
    >
      <CubeIcon className="h-4 w-4 text-primary" />
      {name}
    </motion.div>
  );
}

function FederatedGraphNode({ complete }: { complete: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 2.5 }}
      className="relative flex items-center gap-2 rounded-md border-2 border-primary bg-card px-4 py-3 text-sm font-semibold shadow-sm"
    >
      demo
      {complete && (
        <motion.span
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <CheckCircledIcon className="h-4 w-4 text-green-500" />
        </motion.span>
      )}
    </motion.div>
  );
}

function ConnectionLines() {
  const lineLength = 120;

  return (
    <svg width={lineLength} height="100" className="shrink-0">
      {subgraphs.map((_, i) => {
        const y = 20 + i * 50;
        return (
          <motion.line
            key={i}
            x1={0}
            y1={y}
            x2={lineLength}
            y2={50}
            stroke="currentColor"
            strokeWidth={2}
            className="text-muted-foreground/50"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, delay: 1 + i * 0.3 }}
          />
        );
      })}
    </svg>
  );
}

function CompositionAnimation({ complete }: { complete: boolean }) {
  return (
    <div className="flex items-center justify-center gap-6 rounded-lg border bg-muted/30 px-8 py-12">
      <div className="flex flex-col gap-4">
        {subgraphs.map((sg) => (
          <SubgraphNode key={sg.name} name={sg.name} delay={sg.delay} />
        ))}
      </div>
      <ConnectionLines />
      <FederatedGraphNode complete={complete} />
    </div>
  );
}

interface Step3CreateGraphProps {
  onDismiss: () => void;
  onSubmitSuccess: Dispatch<SetStateAction<Onboarding | undefined>>;
}

export function Step3CreateGraph({ onDismiss, onSubmitSuccess }: Step3CreateGraphProps) {
  const router = useRouter();
  const org = useCurrentOrganization();
  const [compositionComplete, setCompositionComplete] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCompositionComplete(true);
    }, COMPOSITION_DURATION);

    return () => clearTimeout(timer);
  }, []);

  const { mutate, isPending } = useMutation(completeOnboardingStep3);

  const onContinue = () => {
    mutate(
      {
        federatedGraphId: '',
      },
      {
        onSuccess(res) {
          if (res.response?.code === EnumStatusCode.OK && res.onboarding) {
            onSubmitSuccess({
              ...res.onboarding,
              createdAt: new Date(res.onboarding.createdAt),
              finishedAt: res.onboarding.finishedAt ? new Date(res.onboarding.finishedAt) : null,
              updatedAt: res.onboarding.updatedAt ? new Date(res.onboarding.updatedAt) : null,
              federatedGraphId: res.onboarding.federatedGraphId || undefined,
            });
          }
        },
      },
    );
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Create your first graph</h2>
        <p className="text-sm text-muted-foreground">
          Run the following command to create a demo federated graph with sample subgraphs:
        </p>
        <pre className="mt-2 rounded-md bg-muted px-4 py-3 font-mono text-sm">wgc demo</pre>
        <p className="text-xs text-muted-foreground">
          Learn more about the{' '}
          <a
            href={docsBaseURL + '/cli/wgc-demo'}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            <code>wgc demo</code>
          </a>{' '}
          command.
        </p>
      </div>

      <CompositionAnimation complete={compositionComplete} />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onDismiss();
            router.push(`/${org?.slug}/graphs`);
          }}
        >
          Skip
        </Button>
        <Button type="button" onClick={onContinue} disabled={!compositionComplete || isPending}>
          Continue
        </Button>
      </div>
    </div>
  );
}
