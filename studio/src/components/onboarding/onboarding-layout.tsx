import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { useOnboarding } from '@/hooks/use-onboarding';
import { Stepper, type StepperStep } from './stepper';

const ONBOARDING_STEPS: StepperStep[] = [
  { label: 'Settings' },
  { label: 'What is GraphQL Federation?' },
  { label: 'Create your first graph' },
  { label: 'Run your services' },
];

const OnboardingStepper = () => {
  const { onboarding } = useOnboarding();
  return <Stepper steps={ONBOARDING_STEPS} currentStep={onboarding?.step ?? 0} className="pt-2" />;
};

export const getOnboardingLayout = (page: React.ReactNode) => {
  return getDashboardLayout(page, 'Onboarding', <OnboardingStepper />);
};
