import { PlaygroundContext, TabsState, TabState } from '@/components/playground/types';
import { useToast } from '@/components/ui/use-toast';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { PLAYGROUND_DEFAULT_QUERY_TEMPLATE } from '@/lib/constants';
import { extractStateFromUrl } from '@/lib/playground-url-state-decoding';
import { useRouter } from 'next/router';
import { useContext, useEffect } from 'react';

type ScriptData = {
  id?: string;
  title?: string;
  content?: string;
  enabled?: boolean;
  updatedByTabId?: string;
  type?: string;
};

export const useHydratePlaygroundStateFromUrl = (
  tabsState: TabsState,
  setQuery: (query: string) => void,
  setVariables: (variables: string) => void,
  setHeaders: (headers: string) => void,
  setTabsState: (state: TabsState) => void,
  isGraphiqlRendered: boolean,
) => {
  const router = useRouter();
  const { toast } = useToast();
  // `setIsHydrated` is used to avoid race conditions.
  // First hydration should be done from the URL, and 
  // then only childrens of Playground should be able to update state.
  const { setIsHydrated } = useContext(PlaygroundContext);

  const [scriptsTabState, setScriptsTabState] = useLocalStorage<{ [key: string]: Record<string, any> }>('playground:script:tabState', {});
  const [preFlightSelected, setPreFlightSelected] = useLocalStorage<any>('playground:pre-flight:selected', null);
  const [preFlightEnabled, setPreFlightEnabled] = useLocalStorage<any>('playground:pre-flight:enabled', null);
  const [, setPreOpSelected] = useLocalStorage<ScriptData | null>('playground:pre-operation:selected', null);
  const [, setPostOpSelected] = useLocalStorage<ScriptData | null>('playground:post-operation:selected', null);

  useEffect(() => {
    // We have an early bailout condition to avoid race condition with GraphiQL.
    // Let GraphiQL first render and complete its logic related to `onTabChange`.
    // Once that's completed, we can hydrate the state from URL
    // For hydration, we avoid making changes into the active tab index.
    // We instead created a new tab and updated the PlaygroundContext.tabsState
    if (!isGraphiqlRendered || tabsState.tabs.length === 0) {
      return;
    }

    const { playgroundUrlState } = router.query;
    if (!playgroundUrlState || typeof playgroundUrlState !== 'string') {
      setIsHydrated(true);
      return;
    }

    try {
      const state = extractStateFromUrl();
      if (!state) {
        setIsHydrated(true);
        return;
      }

      // Create a new tab with the shared state
      const newTabId = crypto.randomUUID();
      const newTab: TabState = {
        id: newTabId,
        title: '', // GraphiQL will set this automatically
        query: state.operation,
        variables: state.variables || '',
        headers: state.headers || '',
        hash: '',
        operationName: '', // GraphiQL will set this automatically
        response: null,
      };

      // Add the new tab and make it active
      const newTabs = [...tabsState.tabs, newTab];
      setTabsState({
        activeTabIndex: newTabs.length - 1,
        tabs: newTabs,
      });

      // Set the state for the new tab
      setQuery(state.operation);
      if (state.variables) {
        setVariables(state.variables);
      }

      if (state.headers) {
        setHeaders(state.headers);
      }

      if (state.preFlight) {
        setPreFlightSelected(state.preFlight);
      }

      if (state.preOperation || state.postOperation) {
        setScriptsTabState(prev => {
          const updated = { ...prev };
          updated[newTabId] = { ...(updated[newTabId] || {}) };
          if (state.preOperation) {
            updated[newTabId]['pre-operation'] = state.preOperation;
            setPreOpSelected(state.preOperation);
          }
          if (state.postOperation) {
            updated[newTabId]['post-operation'] = state.postOperation;
            setPostOpSelected(state.postOperation);
          }
          return updated;
        });
      }
      setIsHydrated(true);
    } catch (err) {
      if (process.env.NODE_ENV !== 'development') {
        console.error('Error extracting state from URL:', (err as Error)?.message);
      }
      // fallback state when error occurs
      setQuery(PLAYGROUND_DEFAULT_QUERY_TEMPLATE);
      toast({
        title: 'Error loading playground state',
        description: 'The playground has been reset to its default state due to invalid URL parameters.',
        variant: 'destructive',
      });
      setIsHydrated(true);
    } finally {
      // In order to avoid conflicts, it is important to clear the url state after loading it.
      // clearState();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query, isGraphiqlRendered, tabsState.tabs.length]);

  // const clearState = () => {
  //   const { playgroundUrlState, ...query } = router.query;
  //   // critical to do this so that page refresh doesn't show the old state
  //   router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  // };
};