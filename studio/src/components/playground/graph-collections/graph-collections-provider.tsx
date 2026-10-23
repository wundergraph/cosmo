import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TabsState } from '@/components/playground/types';
import {
  bindTab,
  findTabForOperation,
  parseTabBindings,
  pruneBindings,
  TabBinding,
  TabBindings,
  updateBindingHash,
} from '@/lib/graph-collections';

/**
 * Bindings live under the same `cosmo-playground:<graphId>` namespace as
 * GraphiQL's own tab state, so they are scoped per graph and cleared on logout
 * alongside the tabs they point at.
 */
const storageKey = (graphId: string) => `cosmo-playground:${graphId}:graph-collections:tab-bindings`;

type GraphCollectionsContextValue = {
  /** The saved operation a given tab is editing, if any. */
  bindingFor: (tabId: string | undefined) => TabBinding | undefined;
  /**
   * Whether a ?operationId= link has already been opened this visit. Lives here
   * because GraphiQL unmounts plugin content whenever another plugin is shown,
   * so panel-local state would reopen the operation on every toggle.
   */
  hasOpenedDeepLink: boolean;
  markDeepLinkOpened: () => void;
  /** Operation ids with a tab open, so the panel can mark them. */
  boundOperationIds: Set<string>;
  bindTabTo: (tabId: string, binding: TabBinding) => void;
  advanceHash: (tabId: string, contentHash: string) => void;
  findTabFor: (operationId: string) => string | undefined;
};

const GraphCollectionsContext = createContext<GraphCollectionsContextValue | null>(null);

export const useGraphCollectionsContext = () => {
  const context = useContext(GraphCollectionsContext);

  if (!context) {
    throw new Error('useGraphCollectionsContext must be used within a GraphCollectionsProvider');
  }

  return context;
};

export const GraphCollectionsProvider = ({
  children,
  graphId,
  tabsState,
}: PropsWithChildren<{
  graphId: string;
  tabsState: TabsState;
}>) => {
  const [bindings, setBindings] = useState<TabBindings>({});
  const [hasOpenedDeepLink, setHasOpenedDeepLink] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !graphId) {
      return;
    }

    setBindings(parseTabBindings(window.localStorage.getItem(storageKey(graphId))));
    setHydrated(true);
  }, [graphId]);

  const persist = useCallback(
    (next: TabBindings) => {
      setBindings(next);

      if (typeof window !== 'undefined' && graphId) {
        window.localStorage.setItem(storageKey(graphId), JSON.stringify(next));
      }
    },
    [graphId],
  );

  // GraphiQL owns the tab list, so bindings follow it. A closed tab drops its
  // binding rather than leaving a link to an operation nothing is editing.
  useEffect(() => {
    // `onTabChange` does not fire on mount, so pruning against an empty
    // tabsState would read "no tabs" as "every tab closed".
    if (!hydrated || tabsState.tabs.length === 0) {
      return;
    }

    const pruned = pruneBindings(
      bindings,
      tabsState.tabs.map((tab) => tab.id),
    );

    if (Object.keys(pruned).length !== Object.keys(bindings).length) {
      persist(pruned);
    }
  }, [tabsState, bindings, hydrated, persist]);

  const value = useMemo<GraphCollectionsContextValue>(
    () => ({
      bindingFor: (tabId) => (tabId ? bindings[tabId] : undefined),
      hasOpenedDeepLink,
      markDeepLinkOpened: () => setHasOpenedDeepLink(true),
      boundOperationIds: new Set(Object.values(bindings).map((binding) => binding.operationId)),
      bindTabTo: (tabId, binding) => persist(bindTab(bindings, tabId, binding)),
      advanceHash: (tabId, contentHash) => persist(updateBindingHash(bindings, tabId, contentHash)),
      findTabFor: (operationId) => findTabForOperation(bindings, operationId),
    }),
    [bindings, persist, hasOpenedDeepLink],
  );

  return <GraphCollectionsContext.Provider value={value}>{children}</GraphCollectionsContext.Provider>;
};
