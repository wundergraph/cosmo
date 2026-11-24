import { useQueryState } from 'nuqs';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * Whether Hub frames this page. Studio only allows framing for `?embed=1` requests, so a framed page stays
 * embedded after it navigates to a URL without the parameter.
 */
export const useIsEmbedded = () => {
  const [embed] = useQueryState('embed');
  const isFramed = useSyncExternalStore(
    subscribe,
    () => window.self !== window.top,
    () => false,
  );

  return embed === '1' || isFramed;
};
