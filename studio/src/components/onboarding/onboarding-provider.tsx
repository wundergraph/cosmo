import {
  createContext,
  type Dispatch,
  useCallback,
  useContext,
  useMemo,
  useState,
  type SetStateAction,
  type ReactNode,
} from 'react';
import { PostHogFeatureFlagContext } from '../posthog-feature-flag-provider';
import { useSessionStorage } from '@/hooks/use-session-storage';

type Onboarding = {
  finishedAt?: Date;
  federatedGraphsCount: number;
  slack: boolean;
  email: boolean;
};

export interface OnboardingState {
  enabled: boolean;
  onboarding?: Onboarding;
  setOnboarding: Dispatch<SetStateAction<Onboarding | undefined>>;
  currentStep: number | undefined;
  setStep: (step: number | undefined) => void;
  skipped: boolean;
  initialized: boolean;
  setInitialized: () => void;
  setSkipped: () => void;
  resetSkipped: () => void;
}

export const OnboardingContext = createContext<OnboardingState>({
  onboarding: undefined,
  enabled: false,
  setOnboarding: () => undefined,
  currentStep: undefined,
  setStep: () => undefined,
  skipped: false,
  initialized: false,
  setInitialized: () => undefined,
  setSkipped: () => undefined,
  resetSkipped: () => undefined,
});

const ONBOARDING_V1_LAST_STEP = 3;

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const { onboarding: onboardingFlag, status: featureFlagStatus } = useContext(PostHogFeatureFlagContext);
  const [onboarding, setOnboarding] = useState<Onboarding | undefined>(undefined);
  const [currentStep, setCurrentStep] = useSessionStorage<undefined | number>('cosmo-onboarding-v1-step', undefined);
  const [skipped, setSkippedValue] = useSessionStorage('cosmo-onboarding-v1-skipped', false);
  const [initialized, setInitializedValue] = useSessionStorage('cosmo-onboarding-v1-initialized', false);

  const setSkipped = useCallback(() => {
    setSkippedValue(true);
  }, [setSkippedValue]);

  const resetSkipped = useCallback(() => {
    setSkippedValue(false);
  }, [setSkippedValue]);

  const setStep = useCallback(
    (step: number | undefined) => {
      if (step === undefined) {
        setCurrentStep(1);
        resetSkipped();
        return;
      }

      resetSkipped();
      setCurrentStep(Math.max(Math.min(step, ONBOARDING_V1_LAST_STEP), 0));
    },
    [setCurrentStep, resetSkipped],
  );

  const setInitialized = useCallback(() => setInitializedValue(true), [setInitializedValue]);

  const value = useMemo(
    () => ({
      onboarding,
      enabled: Boolean(onboardingFlag.enabled && featureFlagStatus === 'success' && onboardingFlag),
      setOnboarding,
      currentStep,
      setStep,
      setSkipped,
      resetSkipped,
      skipped,
      initialized,
      setInitialized,
    }),
    [
      onboarding,
      onboardingFlag,
      featureFlagStatus,
      currentStep,
      setStep,
      setSkipped,
      resetSkipped,
      skipped,
      initialized,
      setInitialized,
    ],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};
