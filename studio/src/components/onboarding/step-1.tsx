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
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { captureOnboardingEvent } from '@/lib/track';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { Form } from '../ui/form';
import { Checkbox } from '../ui/checkbox';
import { TrafficAnimation } from './traffic-animation';

const onboardingSchema = z.object({
  channels: z.object({
    slack: z.boolean(),
    email: z.boolean(),
  }),
});

type OnboardingFormValues = z.infer<typeof onboardingSchema>;

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
  const { setStep, setSkipped, setOnboarding, onboarding, initialized, setInitialized } = useOnboarding();
  // Referrer can be `wgc` when onboarding is opened via `wgc demo` command
  const referrer = normalizeReferrer(router.query.referrer || document?.referrer);

  const form = useZodForm<OnboardingFormValues>({
    mode: 'onChange',
    schema: onboardingSchema,
    defaultValues: {
      channels: {
        slack: onboarding?.slack ?? true,
        email: onboarding?.email ?? false,
      },
    },
  });

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

      const formValues = form.getValues();
      setOnboarding({
        federatedGraphsCount: d.federatedGraphsCount,
        finishedAt: d.finishedAt ? new Date(d.finishedAt) : undefined,
        slack: formValues.channels.slack,
        email: formValues.channels.email,
      });
      captureOnboardingEvent(posthog, {
        name: 'onboarding_step_completed',
        options: {
          step_name: 'welcome',
          channel: (Object.keys(formValues.channels) as Array<keyof typeof formValues.channels>).filter(
            (key) => formValues.channels[key],
          ),
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

  const onSubmit: SubmitHandler<OnboardingFormValues> = (data) => {
    mutate(data.channels);
  };

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
            In ~<span className="font-medium text-foreground">3 minutes</span> you will have a federated GraphQL graph
            running locally and serving live traffic into Cosmo Cloud platform.
          </p>
        </div>

        <TrafficAnimation />

        <div className="space-y-3">
          <p className="text-sm font-semibold">What you will do</p>
          <ul className="flex flex-col gap-3">
            <WhyListItem
              title="Create your first graph"
              text="See how the products and reviews subgraphs compose into one supergraph, giving your client a single endpoint to resolve the data it needs."
            />
            <WhyListItem
              title="Run your services"
              text="Run the same router stack you would run in production, locally."
            />
            <WhyListItem title="Send a query" text="Watch real request metrics flow through the router." />
          </ul>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="w-full" aria-busy={isPending}>
            <div className="rounded-md border border-dashed p-4">
              <p className="text-sm font-medium">If you get stuck, how can we reach you?</p>
              <div className="mt-3 flex flex-col gap-3">
                <Controller
                  control={form.control}
                  name="channels.slack"
                  render={({ field }) => (
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={field.value}
                        disabled={isPending}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                      <div className="flex flex-col gap-y-1">
                        <span className="text-sm font-medium leading-none">Slack</span>
                        <span className="text-[0.8rem] text-muted-foreground">
                          We automatically create a Slack channel for you.
                        </span>
                      </div>
                    </label>
                  )}
                />
                <Controller
                  control={form.control}
                  name="channels.email"
                  render={({ field }) => (
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={field.value}
                        disabled={isPending}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                      <div className="flex flex-col gap-y-1">
                        <span className="text-sm font-medium leading-none">Email</span>
                        <span className="text-[0.8rem] text-muted-foreground">Receive updates via email.</span>
                      </div>
                    </label>
                  )}
                />
              </div>
            </div>
          </form>
        </Form>
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
        forwardLabel="Start the tour"
        forward={{
          onClick: form.handleSubmit(onSubmit),
          isLoading: isPending,
        }}
      />
    </OnboardingContainer>
  );
};
