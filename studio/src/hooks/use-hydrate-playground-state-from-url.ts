import { TabsState } from '@/components/playground/types';
import { useToast } from '@/components/ui/use-toast';
import { DEFAULT_QUERY_TEMPLATE } from '@/lib/constants';
import { setPreFlightScript, setScriptTabState } from '@/lib/playground-storage';
import { extractStateFromUrl } from '@/lib/playground-url-state-decoding';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export const useHydratePlaygroundStateFromUrl = (
  tabsState: TabsState,
  setQuery: (query: string) => void,
  setVariables: (variables: string) => void,
  setHeaders: (headers: string) => void
) => {
  const activeTabId = tabsState.tabs[tabsState.activeTabIndex]?.id;
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const { playgroundUrlState } = router.query;
    if (!playgroundUrlState || typeof playgroundUrlState !== 'string' || !activeTabId) {
      return;
    }

    try {
      const state = extractStateFromUrl();
      if (!state) return;
          
      setQuery(state.operation);

      if (state.variables) {
        setVariables(state.variables);
      }

      if (state.headers) {
        setHeaders(state.headers);
      }

      if (state.preFlight) {
        setPreFlightScript(state.preFlight);
      }

      if (state.preOperation) {
        setScriptTabState('pre-operation', state.preOperation, activeTabId);
      }

      if (state.postOperation) {
        setScriptTabState('post-operation', state.postOperation, activeTabId);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'development') {
        console.error('Error extracting state from URL:', (err as Error)?.message);
      }
      // fallback state when error occurs
      setQuery(DEFAULT_QUERY_TEMPLATE);
      toast({
        title: 'Error loading playground state',
        description: 'The playground has been reset to its default state due to invalid URL parameters.',
        variant: 'destructive',
      });
    } finally {
      // In order to avoid conflicts, it is important to clear the url state after loading it.
      clearState();
    }
  }, [router.query, activeTabId]);

  const clearState = () => {
    const { playgroundUrlState, ...query } = router.query;
    // critical to do this so that page refresh doesn't show the old state
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
};