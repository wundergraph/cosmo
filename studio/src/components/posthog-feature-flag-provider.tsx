import { ReactNode, createContext, useContext, useEffect, useReducer, useMemo } from 'react';
import { useFeatureFlagEnabled } from 'posthog-js/react';
import { Loader } from '@/components/ui/loader';

type PostHogFeatureFlagStatus = 'idle' | 'disabled' | 'pending' | 'success';

interface PostHogFeatureFlagState {
  status: PostHogFeatureFlagStatus;
  onboarding: {
    enabled: boolean;
  };
}

type PostHogFeatureFlagAction =
  | { type: 'LOADING' }
  | { type: 'LOADED'; onboardingEnabled: boolean }
  | { type: 'DISABLED' };

function postHogFeatureFlagReducer(
  _state: PostHogFeatureFlagState,
  action: PostHogFeatureFlagAction,
): PostHogFeatureFlagState {
  switch (action.type) {
    case 'DISABLED':
      return { status: 'disabled', onboarding: { enabled: false } };
    case 'LOADING':
      return { status: 'pending', onboarding: { enabled: false } };
    case 'LOADED':
      return { status: 'success', onboarding: { enabled: action.onboardingEnabled } };
  }
}

const initialState: PostHogFeatureFlagState = {
  status: 'idle',
  onboarding: { enabled: false },
};

export const PostHogFeatureFlagContext = createContext<PostHogFeatureFlagState>(initialState);

export const usePostHogFeatureFlags = () => useContext(PostHogFeatureFlagContext);

export const PostHogFeatureFlagProvider = ({ children, disabled }: { children: ReactNode; disabled: boolean }) => {
  const onboardingFlag = useFeatureFlagEnabled('cosmo-onboarding-v1');
  const [state, dispatch] = useReducer(postHogFeatureFlagReducer, initialState);

  useEffect(() => {
    if (disabled) {
      dispatch({ type: 'DISABLED' });
    } else if (onboardingFlag === undefined) {
      dispatch({ type: 'LOADING' });
    } else {
      dispatch({ type: 'LOADED', onboardingEnabled: onboardingFlag });
    }
  }, [onboardingFlag, disabled]);

  if (state.status !== 'success' && state.status !== 'disabled') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader />
      </div>
    );
  }

  return <PostHogFeatureFlagContext.Provider value={state}>{children}</PostHogFeatureFlagContext.Provider>;
};
