import { useQuery } from '@connectrpc/connect-query';
import { useEditorContext } from '@graphiql/react';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { getGraphCollectionOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphCollectionsContext } from '@/components/playground/graph-collections/graph-collections-provider';
import { reportFailure } from '@/lib/graph-collections';
import { useGraphCollections } from '@/hooks/use-graph-collections';

type PendingOpen = {
  operationId: string;
  collectionId: string;
  query: string;
  variables: string;
  contentHash: string;
  expected: { query: string; variables: string };
} & (
  | { kind: 'refill'; targetTabId: string }
  // `addTab()` returns nothing, so the tab it appended is identified as the one
  // that was not in the list when beat two asked for it.
  | { kind: 'new-tab'; tabIdsBefore: string[] }
);

type OpenRequest = {
  id: string;
  collectionId: string;
  /** Refill this tab instead of creating one. Set when healing an empty tab. */
  intoTabId?: string;
  /**
   * What the tab held when the refill was asked for. Read here rather than
   * when the body arrives, so anything typed while the fetch was in flight
   * fails the comparison in beat three instead of becoming the baseline.
   */
  expected?: { query: string; variables: string };
};

/**
 * Three beats, because GraphiQL cannot create a tab with contents: fetch the
 * body, ask for a tab, fill it once that tab is active and the editors exist.
 */
export const useOpenOperation = ({ onOperationMissing }: { onOperationMissing: () => void }) => {
  const { bindTabTo, findTabFor, bindingFor } = useGraphCollectionsContext();
  const refillAttempted = useRef<Set<string>>(new Set());
  const { federatedGraphId } = useGraphCollections();
  const { tabs, activeTabIndex, addTab, changeTab, queryEditor, variableEditor, updateActiveTabValues } =
    useEditorContext({ nonNull: true });

  const [openingOperation, setOpeningOperation] = useState<OpenRequest | null>(null);
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(null);

  const [deferredOpen, setDeferredOpen] = useState<{ operationId: string; collectionId: string } | null>(null);

  // Never cached: the response carries the `contentHash` used as the save
  // precondition, and a stale one fails the next save as a phantom conflict.
  const { data: fetchedOperation, isError } = useQuery(
    getGraphCollectionOperation,
    { id: openingOperation?.id ?? '', federatedGraphId, collectionId: openingOperation?.collectionId ?? '' },
    { enabled: !!openingOperation, staleTime: 0, gcTime: 0, refetchOnMount: 'always' },
  );

  // `setOpeningOperation(null)` only lands on the next render, so without this
  // a re-run calls `addTab()` again. Keyed on the object, not the id: an id
  // would block reopening the same operation after its tab was closed.
  const openHandled = useRef<OpenRequest | null>(null);

  const activeTabId = tabs[activeTabIndex]?.id;

  // Refills a tab GraphiQL blanked: its auto-save writes whatever the editor
  // held into whichever tab is active 100ms later. Only repairable on activation.
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
    setOpeningOperation({
      id: binding.operationId,
      collectionId: binding.collectionId,
      intoTabId: active.id,
      expected: { query: active.query ?? '', variables: active.variables ?? '' },
    });
    // Keyed on the active tab id, not `tabs`: `tabs` changes on every keystroke,
    // so this would refill a tab the moment the user cleared it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, bindingFor, openingOperation, pendingOpen]);

  // Beat two: the body arrived, so ask for a tab.
  useEffect(() => {
    if (!openingOperation || !fetchedOperation) {
      return;
    }

    if (openHandled.current === openingOperation) {
      return;
    }

    const operation = fetchedOperation.operation;

    if (fetchedOperation.response?.code !== EnumStatusCode.OK || !operation) {
      reportFailure('Could not open this operation', fetchedOperation.response?.details);
      setOpeningOperation(null);
      onOperationMissing();
      return;
    }

    const body = {
      operationId: operation.id,
      collectionId: operation.collectionId,
      query: operation.query,
      variables: operation.variables,
      contentHash: operation.contentHash,
    };

    const intoTabId = openingOperation.intoTabId;

    setPendingOpen(
      intoTabId
        ? {
            ...body,
            kind: 'refill',
            targetTabId: intoTabId,
            expected: openingOperation.expected ?? { query: '', variables: '' },
          }
        : {
            ...body,
            kind: 'new-tab',
            tabIdsBefore: tabs.map((tab) => tab.id),
            // `addTab()` creates an empty tab, so anything in it is the user's.
            expected: { query: '', variables: '' },
          },
    );
    openHandled.current = openingOperation;
    setOpeningOperation(null);

    if (!intoTabId) {
      addTab();
    }
  }, [openingOperation, fetchedOperation, addTab, onOperationMissing, tabs, activeTabIndex]);

  useEffect(() => {
    if (openingOperation && isError) {
      reportFailure('Could not open this operation');
      setOpeningOperation(null);
    }
  }, [openingOperation, isError]);

  // Beat three: fill the tab that is now active and bind it.
  useEffect(() => {
    // Waits for the editors too: on a cold load they mount late, and writing
    // with `?.` would skip silently and leave a tab with no operation.
    if (!pendingOpen || !activeTabId || !queryEditor || !variableEditor) {
      return;
    }

    const targetTabId =
      pendingOpen.kind === 'refill'
        ? pendingOpen.targetTabId
        : tabs.find((tab) => !pendingOpen.tabIdsBefore.includes(tab.id))?.id;

    // The tab `addTab()` asked for has not rendered yet; this re-runs when it does.
    if (!targetTabId) {
      return;
    }

    const target = tabs.find((tab) => tab.id === targetTabId);

    if (
      (target?.query ?? '') !== pendingOpen.expected.query ||
      (target?.variables ?? '') !== pendingOpen.expected.variables
    ) {
      setPendingOpen(null);
      return;
    }

    // `updateActiveTabValues` always writes to the active tab, so if the user
    // moved away while this was pending, go back before writing.
    if (targetTabId !== activeTabId) {
      const index = tabs.findIndex((tab) => tab.id === targetTabId);

      if (index === -1) {
        setPendingOpen(null);
        return;
      }

      changeTab(index);
      return;
    }

    // Record first: GraphiQL restores a tab's *stored* values on every sync,
    // so setting only the editor is undone. setValue just shows it sooner.
    updateActiveTabValues({ query: pendingOpen.query, variables: pendingOpen.variables ?? '' });

    queryEditor.setValue(pendingOpen.query);
    variableEditor.setValue(pendingOpen.variables ?? '');

    refillAttempted.current.delete(activeTabId);

    bindTabTo(activeTabId, {
      collectionId: pendingOpen.collectionId,
      operationId: pendingOpen.operationId,
      loadedContentHash: pendingOpen.contentHash,
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

  const openOperationNow = useCallback(
    (operationId: string, collectionId: string) => {
      const existingTabId = findTabFor(operationId);

      if (existingTabId) {
        const index = tabs.findIndex((tab) => tab.id === existingTabId);
        if (index !== -1) {
          // Blanked as described above; without this every later open returns here.
          if (!(tabs[index].query ?? '').trim()) {
            changeTab(index);
            setOpeningOperation({
              id: operationId,
              collectionId,
              intoTabId: existingTabId,
              expected: { query: tabs[index].query ?? '', variables: tabs[index].variables ?? '' },
            });
            return;
          }

          changeTab(index);
          return;
        }
      }

      // Same object for a repeated request: a new identity re-runs beat two
      // and calls `addTab()` again. The deep-link effect does fire twice.
      setOpeningOperation((current) =>
        current && current.id === operationId && current.collectionId === collectionId
          ? current
          : { id: operationId, collectionId },
      );
    },
    [findTabFor, tabs, changeTab],
  );

  // Never switch tabs before the editor exists: GraphiQL initialises a
  // late-mounting editor with the tab that was active at first render, then
  // writes it into whatever tab is active by then - stamping the old
  // operation onto the one just opened.
  const openOperation = useCallback(
    (operationId: string, collectionId: string) => {
      if (!queryEditor) {
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

    setDeferredOpen(null);
    openOperationNow(deferredOpen.operationId, deferredOpen.collectionId);
  }, [deferredOpen, queryEditor, openOperationNow]);

  return { openOperation, activeBinding: bindingFor(activeTabId) };
};
