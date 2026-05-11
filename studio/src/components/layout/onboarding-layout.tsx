import { Logo } from '../logo';
import { Card, CardContent } from '../ui/card';
import { Stepper } from '../onboarding/stepper';
import { ONBOARDING_STEPS } from '../onboarding/onboarding-steps';
import { useOnboarding } from '@/hooks/use-onboarding';
import { PageHeader } from './head';

export const OnboardingLayout = ({
  children,
  title,
  bare = false,
}: {
  children?: React.ReactNode;
  title?: string;
  bare?: boolean;
}) => {
  const { currentStep } = useOnboarding();
  const pageTitle = title ? `Onboarding | ${title}` : 'Onboarding';

  return (
    <PageHeader title={pageTitle}>
      <div className="flex min-h-screen w-full flex-col bg-background font-sans antialiased">
        <header className="mx-auto flex w-full max-w-2xl items-center gap-3 py-6">
          <Logo width={32} height={32} />
          {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
          <Stepper steps={ONBOARDING_STEPS} currentStep={(currentStep ?? 1) - 1} className="ml-auto" />
        </header>
        <main className="w-full flex-1 px-6 pb-4 pt-12">
          {bare ? (
            <div className="mx-auto w-full max-w-2xl">{children}</div>
          ) : (
            <Card className="mx-auto w-full max-w-2xl">
              <CardContent className="flex min-h-[788px] flex-col p-6">{children}</CardContent>
            </Card>
          )}
        </main>
      </div>
    </PageHeader>
  );
};
