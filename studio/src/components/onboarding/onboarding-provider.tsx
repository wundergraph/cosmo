import { createContext, useCallback, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';

export interface Onboarding {
  id: string;
  userId: string;
  organizationId: string;
  step: number;
  version: string;
  slack: boolean;
  email: boolean;
  federatedGraphId?: string;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
  nonDemoFederatedGraphsCount: number;
}

export interface OnboardingState {
  onboarding?: Onboarding;
  dismissed: boolean;
  dismissOnboarding: () => void;
  setOnboarding: Dispatch<SetStateAction<Onboarding | undefined>>;
}

export const OnboardingContext = createContext<OnboardingState>({
  onboarding: undefined,
  dismissed: false,
  dismissOnboarding: () => undefined,
  setOnboarding: () => undefined,
});

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const [onboarding, setOnboarding] = useState<Onboarding | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  const dismissOnboarding = useCallback(() => {
    setDismissed(true);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        onboarding,
        dismissed,
        dismissOnboarding,
        setOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};
