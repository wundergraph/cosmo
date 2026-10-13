import { useQuery } from '@connectrpc/connect-query';
import { useEditorContext } from '@graphiql/react';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getGraphCollectionOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphCollectionsContext } from '@/components/playground/graph-collections/graph-collections-provider';
import { reportFailure, trace } from '@/lib/graph-collections';
import { useGraphCollections } from '@/hooks/use-graph-collections';

/** What we are waiting to place into a freshly opened tab. */
type PendingOpen = {
  operationId: string;
  collectionId: string;
  query: string;
  variables: string;
  contentHash: string;
  /** Set when refilling an existing tab, in which case no tab was created. */
  targetTabId?: string;
};

/**
 * Opens a saved operation into a GraphiQL tab.
 *
 * Opening is three beats rather than one, because GraphiQL's tab API gives us
 * no way to create a tab with contents:
 *
 *   1. Fetch the body. The list response carries metadata only, so the query
 *      text does not exist on the client until now.
 *   2. Ask GraphiQL for a tab. `addTab()` takes no arguments and the new tab's
 *      id is only knowable after it re-renders.
 *   3. Once that tab is active and the editors exist, write the contents and
 *      record the binding.
 *
 * Must be called from inside GraphiQL's provider tree, since it uses the
 * editor and tab APIs.
 */
export const useOpenOperation = ({
  onOperationMissing,
}: {
  /** Called when the fetch fails, so the caller can refresh a stale list. */
  onOperationMissing: () => void;
}) => {
  const { bindTabTo, findTabFor, bindingFor } = useGraphCollectionsContext();
  /** Tabs we have already tried to refill, so a failed fetch cannot loop. */
  const refillAttempted = useRef<Set<string>>(new Set());
  const { federatedGraphId } = useGraphCollections();
  const { tabs, activeTabIndex, addTab, changeTab, queryEditor, variableEditor, updateActiveTabValues } =
    useEditorContext({ nonNull: true });

  const [openingOperation, setOpeningOperation] = useState<{
    id: string;
    collectionId: string;
    /** Refill this tab instead of creating one. Set when healing an empty tab. */
    intoTabId?: string;
  } | null>(null);
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null);

  /**
   * An open requested before the query editor existed. See `openOperation`.
   */
  const [deferredOpen, setDeferredOpen] = useState<{ operationId: string; collectionId: string } | null>(null);

  // Never cached: the response carries the `contentHash` that becomes this
  // tab's save precondition, and a stale one fails the first save as a
  // conflict for no visible reason.
  const { data: fetchedOperation, isError } = useQuery(
    getGraphCollectionOperation,
    { id: openingOperation?.id ?? '', federatedGraphId, collectionId: openingOperation?.collectionId ?? '' },
    { enabled: !!openingOperation, staleTime: 0, gcTime: 0, refetchOnMount: 'always' },
  );

  // Diagnostic: what each tab *stores*, not what the editor shows. GraphiQL
  // re-syncs from these records on every tab change.
  const lastSnapshot = useRef('');

  useEffect(() => {
    const snapshot = tabs
      .map((tab) => `${tab.id.slice(0, 8)}=${(tab.query || '').split('\n')[0] || '(empty)'}`)
      .join('  |  ');

    if (snapshot !== lastSnapshot.current) {
      lastSnapshot.current = snapshot;
      trace('tabs:records', { activeTabIndex, snapshot });
    }
  }, [tabs, activeTabIndex]);

  // `setOpeningOperation(null)` only lands on the next render, so without this
  // a re-run in between calls `addTab()` again and leaves a blank tab behind.
  const openHandled = useRef<string | null>(null);

  /**
   * Refills a bound tab that has lost its document.
   *
   * GraphiQL can blank a tab behind our backs: its editor auto-save writes
   * whatever the editor held into whichever tab is active 100ms later. We
   * cannot prevent it, nor repair a tab in the background - `updateActiveTabValues`
   * only writes to the active one - but we can restore it once it is activated.
   */
  useEffect(() => {
    const active = tabs[activeTabIndex];

    if (!active || (active.query ?? '').trim() || openingOperation || pendingOpen) {
      return;
    }

    const binding = bindingFor(active.id);

    if (!binding || refillAttempted.current.has(active.id)) {
      return;
    }

    refillAttempted.current.add(active.id);
    trace('refill:empty-active-tab', { tabId: active.id.slice(0, 8) });
    setOpeningOperation({
      id: binding.operationId,
      collectionId: binding.collectionId,
      intoTabId: active.id,
    });
  }, [tabs, activeTabIndex, bindingFor, openingOperation, pendingOpen]);

  // Beat two: the body arrived, so ask for a tab.
  useEffect(() => {
    if (!openingOperation || !fetchedOperation) {
      return;
    }

    if (openHandled.current === openingOperation.id) {
      return;
    }

    const operation = fetchedOperation.operation;

    if (fetchedOperation.response?.code !== EnumStatusCode.OK || !operation) {
      reportFailure('Could not open this operation', fetchedOperation.response?.details);
      setOpeningOperation(null);
      onOperationMissing();
      return;
    }

    trace('beat2:addTab', {
      operationId: operation.id,
      queryFirstLine: operation.query.split('\n')[0],
      tabIdsBefore: tabs.map((tab) => tab.id.slice(0, 8)),
      activeTabIdBefore: tabs[activeTabIndex]?.id.slice(0, 8),
    });

    setPendingOpen({
      operationId: operation.id,
      collectionId: operation.collectionId,
      query: operation.query,
      variables: operation.variables,
      contentHash: operation.contentHash,
      targetTabId: openingOperation.intoTabId,
    });
    openHandled.current = operation.id;
    setOpeningOperation(null);

    if (!openingOperation.intoTabId) {
      addTab();
    }
  }, [openingOperation, fetchedOperation, addTab, onOperationMissing, tabs, activeTabIndex]);

  useEffect(() => {
    if (openingOperation && isError) {
      reportFailure('Could not open this operation');
      setOpeningOperation(null);
    }
  }, [openingOperation, isError]);

  const activeTabId = tabs[activeTabIndex]?.id;

  // Beat three: fill the tab that is now active and bind it.
  useEffect(() => {
    // Waits for the editors as well as the tab: on a cold load they mount after
    // the collections query resolves, and writing with `?.` would skip silently
    // and then clear pendingOpen, leaving a tab that never gets its operation.
    if (pendingOpen) {
      trace('beat3:enter', {
        operationId: pendingOpen.operationId,
        activeTabId: activeTabId?.slice(0, 8),
        activeTabIndex,
        hasQueryEditor: !!queryEditor,
        hasVariableEditor: !!variableEditor,
      });
    }

    if (!pendingOpen || !activeTabId || !queryEditor || !variableEditor) {
      return;
    }

    // When refilling, only write once that tab is the active one, since
    // `updateActiveTabValues` always targets whichever tab is active.
    if (pendingOpen.targetTabId && pendingOpen.targetTabId !== activeTabId) {
      const index = tabs.findIndex((tab) => tab.id === pendingOpen.targetTabId);

      if (index === -1) {
        setPendingOpen(null);
        return;
      }

      changeTab(index);
      return;
    }

    // Record first: GraphiQL restores a tab's *stored* values on every sync, so
    // setting only the editor is undone the moment anything re-syncs. The
    // setValue calls below just make it visible before the next sync.
    updateActiveTabValues({ query: pendingOpen.query, variables: pendingOpen.variables ?? '' });

    queryEditor.setValue(pendingOpen.query);
    variableEditor.setValue(pendingOpen.variables ?? '');

    refillAttempted.current.delete(activeTabId);

    bindTabTo(activeTabId, {
      collectionId: pendingOpen.collectionId,
      operationId: pendingOpen.operationId,
      loadedContentHash: pendingOpen.contentHash,
    });

    trace('beat3:bound', {
      operationId: pendingOpen.operationId,
      boundTabId: activeTabId.slice(0, 8),
      wroteFirstLine: pendingOpen.query.split('\n')[0],
    });

    setPendingOpen(null);
  }, [
    pendingOpen,
    activeTabId,
    activeTabIndex,
    tabs,
    changeTab,
    queryEditor,
    variableEditor,
    bindTabTo,
    updateActiveTabValues,
  ]);

  /**
   * Focuses the tab already editing this operation, or starts the open above.
   *
   * Reusing the tab is what stops repeated clicks producing several tabs that
   * each claim the operation, with competing save preconditions.
   */
  const openOperationNow = useCallback(
    (operationId: string, collectionId: string) => {
      const existingTabId = findTabFor(operationId);

      trace('open:requested', {
        operationId,
        existingTabId: existingTabId?.slice(0, 8),
        tabIds: tabs.map((tab) => tab.id.slice(0, 8)),
      });

      if (existingTabId) {
        const index = tabs.findIndex((tab) => tab.id === existingTabId);
        if (index !== -1) {
          // Blanked by the auto-save described above. Without this the binding
          // sends every later open back to that same empty tab, permanently.
          if (!(tabs[index].query ?? '').trim()) {
            trace('open:refilling', { operationId, tabId: existingTabId.slice(0, 8) });
            changeTab(index);
            setOpeningOperation({ id: operationId, collectionId, intoTabId: existingTabId });
            return;
          }

          changeTab(index);
          return;
        }
      }

      // Same object for a repeated request: a new identity re-runs beat two,
      // which calls `addTab()` again. The deep-link effect does fire twice.
      setOpeningOperation((current) =>
        current && current.id === operationId && current.collectionId === collectionId
          ? current
          : { id: operationId, collectionId },
      );
    },
    [findTabFor, tabs, changeTab],
  );

  /**
   * Switching tabs before the query editor exists corrupts the tab we switch
   * to. GraphiQL initialises a late-mounting editor with the document of
   * whichever tab was active when the provider first rendered, then writes that
   * document into whatever tab is active by the time it mounts - so a deep link
   * that switches first makes the editor stamp the previous tab's operation
   * onto the one it opened. Covered by `graphiql-tab-clobber.test.tsx`.
   *
   * On a cold load the editors mount after the collections query resolves, so
   * this is the common path for a shared link, not an edge case.
   */
  const openOperation = useCallback(
    (operationId: string, collectionId: string) => {
      if (!queryEditor) {
        trace('open:deferred', { operationId });
        setDeferredOpen({ operationId, collectionId });
        return;
      }

      openOperationNow(operationId, collectionId);
    },
    [queryEditor, openOperationNow],
  );

  useEffect(() => {
    if (!deferredOpen || !queryEditor) {
      return;
    }

    trace('open:deferred-resumed', { operationId: deferredOpen.operationId });
    setDeferredOpen(null);
    openOperationNow(deferredOpen.operationId, deferredOpen.collectionId);
  }, [deferredOpen, queryEditor, openOperationNow]);

  return { openOperation, activeBinding: bindingFor(activeTabId) };
};
