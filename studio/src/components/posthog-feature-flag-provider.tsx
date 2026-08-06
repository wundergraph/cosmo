import { ReactNode, createContext, useContext, useMemo } from 'react';
import { useFeatureFlagEnabled } from 'posthog-js/react';

type PostHogFeatureFlagStatus = 'disabled' | 'success';

interface PostHogFeatureFlagState {
  status: PostHogFeatureFlagStatus;
  onboarding: {
    enabled: boolean;
  };
}

const initialState: PostHogFeatureFlagState = {
  status: 'disabled',
  onboarding: { enabled: false },
};

export const PostHogFeatureFlagContext = createContext<PostHogFeatureFlagState>(initialState);

export const usePostHogFeatureFlags = () => useContext(PostHogFeatureFlagContext);

export const PostHogFeatureFlagProvider = ({ children, disabled }: { children: ReactNode; disabled: boolean }) => {
  // Flags are a progressive enhancement, never a precondition for rendering the
  // studio. `useFeatureFlagEnabled` yields `undefined` for as long as flags are
  // unresolved, which includes states it never recovers from: consent rejected
  // (PostHog then runs cookieless with persistence disabled, so nothing is
  // cached between loads), request blocked, or PostHog unreachable. Passing an
  // explicit default keeps those cases as "onboarding off" instead of a value
  // the app would have to wait on.
  const onboardingEnabled = useFeatureFlagEnabled('cosmo-onboarding-v1', false);

  const value = useMemo<PostHogFeatureFlagState>(
    () => ({
      status: disabled ? 'disabled' : 'success',
      onboarding: { enabled: !disabled && onboardingEnabled },
    }),
    [disabled, onboardingEnabled],
  );

  return <PostHogFeatureFlagContext.Provider value={value}>{children}</PostHogFeatureFlagContext.Provider>;
};
