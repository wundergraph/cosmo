import { ReactNode, createContext, useContext, useEffect, useReducer, useMemo } from 'react';
import { useFeatureFlagEnabled } from 'posthog-js/react';
import { Loader } from '@/components/ui/loader';

type FeatureFlagStatus = 'idle' | 'pending' | 'success';

interface FeatureFlagState {
  status: FeatureFlagStatus;
  onboarding: {
    enabled: boolean;
  };
}

type FeatureFlagAction = { type: 'LOADING' } | { type: 'LOADED'; onboardingEnabled: boolean };

function featureFlagReducer(_state: FeatureFlagState, action: FeatureFlagAction): FeatureFlagState {
  switch (action.type) {
    case 'LOADING':
      return { status: 'pending', onboarding: { enabled: false } };
    case 'LOADED':
      return { status: 'success', onboarding: { enabled: action.onboardingEnabled } };
  }
}

const initialState: FeatureFlagState = {
  status: 'idle',
  onboarding: { enabled: false },
};

const FeatureFlagContext = createContext<FeatureFlagState>(initialState);

export const useFeatureFlags = () => useContext(FeatureFlagContext);

export const FeatureFlagProvider = ({ children }: { children: ReactNode }) => {
  const onboardingFlag = useFeatureFlagEnabled('cosmo-onboarding-v1');
  const [state, dispatch] = useReducer(featureFlagReducer, initialState);

  useEffect(() => {
    if (onboardingFlag === undefined) {
      dispatch({ type: 'LOADING' });
    } else {
      dispatch({ type: 'LOADED', onboardingEnabled: onboardingFlag });
    }
  }, [onboardingFlag]);

  if (state.status !== 'success') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader />
      </div>
    );
  }

  return <FeatureFlagContext.Provider value={state}>{children}</FeatureFlagContext.Provider>;
};
