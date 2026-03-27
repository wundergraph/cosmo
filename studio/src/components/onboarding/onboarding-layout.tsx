import { getDashboardLayout } from '@/components/layout/dashboard-layout';
import { Stepper, type StepperStep } from './stepper';

const ONBOARDING_STEPS: StepperStep[] = [
  { label: 'Settings' },
  { label: 'Create demo graph' },
  { label: 'Run router & metrics' },
];

export const getOnboardingLayout = (page: React.ReactNode, currentStep: number) => {
  return getDashboardLayout(
    page,
    'Onboarding',
    <Stepper steps={ONBOARDING_STEPS} currentStep={currentStep} className="pt-2" />,
  );
};
