import { PlaygroundContext, PlaygroundUrlState, PostOperationUrlState, PreOperationUrlState, TabsState, TabState } from '@/components/playground/types';
import { useToast } from '@/components/ui/use-toast';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { extractStateFromUrl } from '@/lib/playground-url-state-decoding';
import { useRouter } from 'next/router';
import { useContext, useEffect, useState } from 'react';

type ScriptData = {
  id?: string;
  title?: string;
  content?: string;
  enabled?: boolean;
  updatedByTabId?: string;
  type?: string;
};

/**
 * Pending Items:
 * 
 * 1. [ENG-7093] Ensure sharing of scripts is working. Right now, after the hydration is completed, the GraphiQL
 *    is adding a new tab internally which overrides the script:tabsState as for the new tab, 
 *    it is missing in the localstorage. We don't have a clean way to prevent GraphiQL from 
 *    adding a new tab. Instead of building hacks on top of hacks, we should revisit this
 *    and consider creating our own GraphiQL component.
 * 2. Add sharing of pre-flight enabled state.
 * 3. For now, the customers won't be shown the scripts options (preflight, preOperation and 
 *    postOperation) for sharing
 */
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

  const [, setScriptsTabState] = useLocalStorage<{ [key: string]: Record<string, any> }>('playground:script:tabState', {});
  const [, setPreFlightSelected] = useLocalStorage<any>('playground:pre-flight:selected', null);
  // todo: add sharing of pre-flight enabled state
  const [, setPreFlightEnabled] = useLocalStorage<any>('playground:pre-flight:enabled', null);
  const [, setPreOpSelected] = useLocalStorage<ScriptData | null>('playground:pre-operation:selected', null);
  const [, setPostOpSelected] = useLocalStorage<ScriptData | null>('playground:post-operation:selected', null);

  const [pendingHydrationState, setPendingHydrationState] = useState<PlaygroundUrlState | null>(null);

  // On mount: extract and clear URL state
  useEffect(() => {
    const { playgroundUrlState, ...query } = router.query;
    try {
      if (playgroundUrlState && typeof playgroundUrlState === 'string') {
        const state = extractStateFromUrl();
        if (!state) {
          setIsHydrated(true);
          return;
        }
  
        setPendingHydrationState(state);
      } else {
        setIsHydrated(true);
        return;
      }
    }
    catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[Playground] Error extracting state from URL:', (err as Error)?.message);
      }
      toast({
        title: 'Unable to Load Shared Playground State',
        description: 'The shared URL may be incorrect. Please double-check and try again.',
        variant: 'destructive',
      });
      setIsHydrated(true);
    }
    finally {
      // Clear the URL param immediately
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    }
    // eslint-disable-next-line
  }, []);
 
  const setOperationScripts = (
    preOperation: PreOperationUrlState,
    postOperation: PostOperationUrlState,
    newTabId: string
  ) => {
    setScriptsTabState(prev => {
      const updated = { ...prev };
      updated[newTabId] = { ...(updated[newTabId] || {}) };

      if (preOperation) {
        updated[newTabId]['pre-operation'] = preOperation;
        setPreOpSelected(preOperation);
      }

      if (postOperation) {
        updated[newTabId]['post-operation'] = postOperation;
        setPostOpSelected(postOperation);
      }

      return updated;
    });
  }

  const addNewTabForHydration = (state: PlaygroundUrlState) => {
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

    return newTabId;
  }

  useEffect(() => {
    // We have an early bailout condition to avoid race condition with GraphiQL.
    // Let GraphiQL first render and complete its logic related to `onTabChange`.
    // Once that's completed, we can hydrate the state from URL
    // For hydration, we avoid making changes into the active tab index.
    // We instead created a new tab and updated the PlaygroundContext.tabsState
    if (!isGraphiqlRendered || tabsState.tabs.length === 0 || !pendingHydrationState) {
      return;
    }

    const newTabId = addNewTabForHydration(pendingHydrationState);
    if (process.env.NODE_ENV === 'development') {
      console.info('[Playground] New tab added for hydration: ', newTabId);
    }
    
    // Set the state for the new tab
    setQuery(pendingHydrationState.operation);
    if (pendingHydrationState.variables) {
      setVariables(pendingHydrationState.variables);
    }

    if (pendingHydrationState.headers) {
      setHeaders(pendingHydrationState.headers);
    }

    if (pendingHydrationState.preFlight) {
      setPreFlightSelected(pendingHydrationState.preFlight);
    }

    if (pendingHydrationState.preOperation || pendingHydrationState.postOperation) {
      setOperationScripts(
        pendingHydrationState.preOperation,
        pendingHydrationState.postOperation,
        newTabId
      );
    }

    setIsHydrated(true);
    setPendingHydrationState(null);
    
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHydrationState, isGraphiqlRendered, tabsState.tabs.length]);
};