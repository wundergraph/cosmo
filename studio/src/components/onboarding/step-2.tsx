import { useEffect } from 'react';
import { useOnboarding } from '@/hooks/use-onboarding';
import { OnboardingContainer } from './onboarding-container';
import { OnboardingNavigation } from './onboarding-navigation';
import { ActivityLogIcon, CheckCircledIcon, Component1Icon, RocketIcon } from '@radix-ui/react-icons';

const FeatureCard = ({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card/50 p-5">
      <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">{icon}</div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[0.8rem] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
};

export const Step2 = () => {
  const { setStep, setSkipped } = useOnboarding();

  useEffect(() => {
    setStep(2);
  }, [setStep]);

  return (
    <OnboardingContainer>
      <p className="text-base text-muted-foreground">
        A quick look at what Cosmo does and why it matters for your team.
      </p>

      <div className="grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-2">
        <FeatureCard icon={<Component1Icon className="size-5 text-primary" />} title="Many services. One graph.">
          GraphQL Federation lets separate services feel like one API. With Cosmo, developers get one place to query
          data instead of stitching together calls across many backends.
        </FeatureCard>

        <FeatureCard icon={<RocketIcon className="size-5 text-primary" />} title="Teams move without bottlenecks.">
          Each team can own and evolve its part of the graph on its own schedule. Cosmo is built so service teams can
          ship independently while platform teams keep visibility and control.
        </FeatureCard>

        <FeatureCard icon={<CheckCircledIcon className="size-5 text-primary" />} title="Changes stay safe.">
          Cosmo helps catch unsafe schema changes before they reach production. That means teams can iterate faster
          without surprising the apps and clients that rely on the graph.
        </FeatureCard>

        <FeatureCard icon={<ActivityLogIcon className="size-5 text-primary" />} title="See what's happening.">
          Built-in metrics and OpenTelemetry tracing show how requests move through the graph and its services. When
          something slows down or fails, you can find it quickly and improve with confidence.
        </FeatureCard>
      </div>

      <OnboardingNavigation onSkip={setSkipped} backHref="/onboarding/1" forward={{ href: '/onboarding/3' }} />
    </OnboardingContainer>
  );
};
