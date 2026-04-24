export interface StepperStep {
  number: number;
  label: string;
}

export const ONBOARDING_STEPS: StepperStep[] = [
  { number: 1, label: 'Get started with WunderGraph' },
  { number: 2, label: 'Create your first graph' },
  { number: 3, label: 'Run your services' },
];
