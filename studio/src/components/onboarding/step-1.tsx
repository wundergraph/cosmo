import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { usePostHog } from 'posthog-js/react';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';
import { useMutation } from '@connectrpc/connect-query';
import { createOnboarding } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useRouter } from 'next/router';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { useToast } from '../ui/use-toast';
import { captureOnboardingEvent } from '@/lib/track';
import { TrafficAnimation } from './traffic-animation';

const WhyListItem = ({ title, text }: { title: string; text: string }) => (
  <li className="flex gap-2">
    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
    <div className="flex flex-col">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-sm text-muted-foreground">{text}</span>
    </div>
  </li>
);

const normalizeReferrer = (referrer: string | string[]): string => {
  if (Array.isArray(referrer)) {
    return referrer.join(' ');
  }

  return referrer;
};

export const Step1 = () => {
  const router = useRouter();
  const posthog = usePostHog();
  const { toast } = useToast();
  const { setStep, setSkipped, setOnboarding, initialized, setInitialized } = useOnboarding();
  // Referrer can be `wgc` when onboarding is opened via `wgc demo` command
  const referrer = normalizeReferrer(router.query.referrer || document?.referrer);

  const { mutate, isPending } = useMutation(createOnboarding, {
    onSuccess: (d) => {
      if (d.response?.code !== EnumStatusCode.OK) {
        const description = d.response?.details ?? 'We had issues with storing your data. Please try again.';
        toast({
          description,
          duration: 3000,
        });
        captureOnboardingEvent(posthog, {
          name: 'onboarding_step_failed',
          options: {
            step_name: 'welcome',
            error_category: 'resource',
            error_message: description,
          },
        });
        return;
      }

      setOnboarding({
        federatedGraphsCount: d.federatedGraphsCount,
        finishedAt: d.finishedAt ? new Date(d.finishedAt) : undefined,
      });
      captureOnboardingEvent(posthog, {
        name: 'onboarding_step_completed',
        options: {
          step_name: 'welcome',
        },
      });
      router.push('/onboarding/2');
    },
    onError: (error) => {
      const description = error.details.toString() ?? 'We had issues with storing your data. Please try again.';
      toast({
        description,
        duration: 3000,
      });
      captureOnboardingEvent(posthog, {
        name: 'onboarding_step_failed',
        options: {
          step_name: 'welcome',
          error_category: 'resource',
          error_message: description,
        },
      });
    },
  });

  useEffect(() => {
    setStep(1);
    setInitialized();
  }, [setStep, setInitialized]);

  useEffect(() => {
    // We only want to trigger the started event once, when user is shown the first
    // step of the onboarding. In case the user re-visits by going back, we don't
    // fire it again.
    if (initialized) return;

    captureOnboardingEvent(posthog, {
      name: 'onboarding_started',
      options: {
        entry_source: referrer,
      },
    });
  }, [initialized, referrer, posthog]);

  return (
    <OnboardingContainer>
      <div className="flex w-full flex-col gap-8 text-left">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            In ~<span className="font-medium text-foreground">3 minutes</span>, you’ll have a federated GraphQL graph
            running locally and reporting live traffic to Cosmo Cloud.
          </p>
        </div>

        <TrafficAnimation />

        <div className="space-y-3">
          <p className="text-sm font-semibold">What you&apos;ll get:</p>
          <ul className="flex flex-col gap-3">
            <WhyListItem
              title="Composed federated graph"
              text="See how the products and reviews subgraphs compose into one supergraph, giving your client a single endpoint to resolve the data it needs."
            />
            <WhyListItem
              title="Connected Cosmo router"
              text="Run the same router stack you would run in production, locally."
            />
            <WhyListItem title="Live metrics" text="Watch real request metrics flow through the router." />
          </ul>
        </div>
      </div>

      <OnboardingNavigation
        onSkip={() => {
          captureOnboardingEvent(posthog, {
            name: 'onboarding_skipped',
            options: {
              step_name: 'welcome',
            },
          });
          setSkipped();
        }}
        forwardLabel="Start"
        forward={{
          onClick: () => mutate({}),
          isLoading: isPending,
        }}
      />
    </OnboardingContainer>
  );
};
