import {
  createContext,
  type Dispatch,
  useContext,
  useMemo,
  useState,
  type SetStateAction,
  type ReactNode,
} from 'react';
import { PostHogFeatureFlagContext } from '../posthog-feature-flag-provider';

type Onboarding = {
  step: number;
  finishedAt?: Date;
  federatedGraphsCount: number;
};

export interface OnboardingState {
  enabled: boolean;
  onboarding?: Onboarding;
  setOnboarding: Dispatch<SetStateAction<Onboarding | undefined>>;
}

export const OnboardingContext = createContext<OnboardingState>({
  onboarding: undefined,
  enabled: false,
  setOnboarding: () => undefined,
});

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const { onboarding: onboardingFlag, status: featureFlagStatus } = useContext(PostHogFeatureFlagContext);
  const [onboarding, setOnboarding] = useState<Onboarding | undefined>(undefined);

  const value = useMemo(
    () => ({
      onboarding,
      enabled: Boolean(onboardingFlag.enabled && featureFlagStatus === 'success' && onboardingFlag),
      setOnboarding,
    }),
    [onboarding, onboardingFlag, featureFlagStatus],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
};
