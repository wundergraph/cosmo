import { OnboardingLayout } from '@/components/layout/onboarding-layout';
import { ONBOARDING_STEPS } from '@/components/onboarding/onboarding-steps';
import { Step1 } from '@/components/onboarding/step-1';
import { Step2 } from '@/components/onboarding/step-2';
import { Step3 } from '@/components/onboarding/step-3';
import { NextPageWithLayout } from '@/lib/page';
import { useRouter } from 'next/router';

const normalizeOnboardingStep = (step: string | string[] | undefined) => {
  const value = Array.isArray(step) ? step[0] : step;
  const parsedStep = Number.parseInt(value ?? '', 10);

  if (!Number.isInteger(parsedStep)) {
    return 1;
  }

  return Math.min(Math.max(parsedStep, 1), ONBOARDING_STEPS.length);
};

const OnboardingStep: NextPageWithLayout = () => {
  const router = useRouter();
  const stepNumber = normalizeOnboardingStep(router.query.step);
  const title = ONBOARDING_STEPS[stepNumber - 1]?.label;

  switch (stepNumber) {
    case 1:
      return (
        <OnboardingLayout title={title}>
          <Step1 />
        </OnboardingLayout>
      );
    case 2:
      return (
        <OnboardingLayout title={title}>
          <Step2 />
        </OnboardingLayout>
      );
    case 3:
      return (
        <OnboardingLayout title={title} bare>
          <Step3 />
        </OnboardingLayout>
      );
    default:
      return null;
  }
};

OnboardingStep.getLayout = (page) => page;

export default OnboardingStep;
