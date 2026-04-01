export interface StepperStep {
  number: number;
  label: string;
}

export const ONBOARDING_STEPS: StepperStep[] = [
  { number: 1, label: 'Information about you' },
  { number: 2, label: 'What is GraphQL Federation?' },
  { number: 3, label: 'Create your first graph' },
  { number: 4, label: 'Run your services' },
];
