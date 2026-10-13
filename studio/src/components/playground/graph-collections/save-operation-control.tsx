import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { useEditorContext } from '@graphiql/react';
import { useToast } from '@/components/ui/use-toast';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  createGraphCollectionOperation,
  getGraphCollectionOperation,
  updateGraphCollectionOperation,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { FormEvent, useEffect, useState } from 'react';
import { FiSave } from 'react-icons/fi';
import { PersistOperationDialog } from '../persist-operation-dialog';
import { SaveConflictDialog } from './dialogs/save-conflict-dialog';
import { SaveOperationDialog } from './dialogs/save-operation-dialog';
import { useGraphCollectionsContext } from './graph-collections-provider';
import { operationSaveError, reportFailure, suggestOperationName } from '@/lib/graph-collections';
import { useGraphCollections } from '@/hooks/use-graph-collections';

type SaveAsState = { open: boolean; name: string; collectionId: string };

/**
 * The playground toolbar's entry point into collections. Save updates the
 * operation the focused tab is bound to, Save to collection creates one, and
 * Save as creates a copy and rebinds the tab to it.
 */
export const SaveOperationControl = () => {
  const { toast } = useToast();
  const { collections, refetch, federatedGraphId } = useGraphCollections();
  const { bindingFor, bindTabTo, advanceHash } = useGraphCollectionsContext();

  const { queryEditor, variableEditor, tabs, activeTabIndex } = useEditorContext({ nonNull: true });

  // The live tab, not the page's mirror: `onTabChange` does not fire on mount,
  // so a restored tab would look unbound and "Save" would duplicate it.
  const activeTabId = tabs[activeTabIndex]?.id;
  const activeBinding = bindingFor(activeTabId);

  // Read at call time. These are CodeMirror instances, so a value captured
  // during render goes stale the moment the user keeps typing.
  const currentQuery = () => queryEditor?.getValue() ?? '';
  const currentVariables = () => variableEditor?.getValue() ?? '';

  // Subscribing is the only way to track this reactively, per the above.
  // Switching tabs fires `change` too, since GraphiQL sets the editor's value.
  const [hasOperation, setHasOperation] = useState(false);

  useEffect(() => {
    if (!queryEditor) {
      return;
    }

    const sync = () => setHasOperation(Boolean(queryEditor.getValue().trim()));

    sync();
    queryEditor.on('change', sync);

    return () => queryEditor.off('change', sync);
  }, [queryEditor]);

  const [saveAs, setSaveAs] = useState<SaveAsState>({ open: false, name: '', collectionId: '' });
  const [conflictOpen, setConflictOpen] = useState(false);
  const [persistOpen, setPersistOpen] = useState(false);

  const createOperation = useMutation(createGraphCollectionOperation);
  const updateOperation = useMutation(updateGraphCollectionOperation);

  // Conflict recovery only: shows their version, and reloads it if you discard yours.
  const { data: serverVersion, refetch: refetchServerVersion } = useQuery(
    getGraphCollectionOperation,
    { id: activeBinding?.operationId ?? '', federatedGraphId, collectionId: activeBinding?.collectionId ?? '' },
    { enabled: false },
  );

  const editable = collections.filter((collection) => collection.canEdit);

  const saveExisting = () => {
    if (!activeBinding || !activeTabId) {
      return;
    }

    const invalid = operationSaveError(currentQuery(), currentVariables());
    if (invalid) {
      reportFailure('Could not save the operation', invalid);
      return;
    }

    updateOperation.mutate(
      {
        id: activeBinding.operationId,
        query: currentQuery(),
        variables: currentVariables(),
        expectedContentHash: activeBinding.loadedContentHash,
        federatedGraphId,
        collectionId: activeBinding.collectionId,
      },
      {
        onSuccess: ({ response, contentHash }) => {
          if (response?.code === EnumStatusCode.ERR_CONFLICT) {
            refetchServerVersion();
            setConflictOpen(true);
            return;
          }

          if (response?.code !== EnumStatusCode.OK) {
            reportFailure('Could not save the operation', response?.details);
            return;
          }

          // Advance the precondition, or the next save would conflict with
          // this one.
          advanceHash(activeTabId, contentHash);
          toast({ description: 'Operation saved', duration: 2000 });
          refetch();
        },
        onError: () => reportFailure('Could not save the operation'),
      },
    );
  };

  const createInto = (collectionId: string, name: string, onDone: () => void) => {
    const invalid = operationSaveError(currentQuery(), currentVariables());
    if (invalid) {
      reportFailure('Could not save the operation', invalid);
      return;
    }

    createOperation.mutate(
      { collectionId, name, query: currentQuery(), variables: currentVariables(), federatedGraphId },
      {
        onSuccess: ({ response, id, contentHash }) => {
          if (response?.code !== EnumStatusCode.OK) {
            reportFailure('Could not save the operation', response?.details);
            return;
          }

          if (activeTabId) {
            bindTabTo(activeTabId, { collectionId, operationId: id, loadedContentHash: contentHash });
          }

          toast({ description: 'Operation saved', duration: 2000 });
          refetch();
          onDone();
        },
        onError: () => reportFailure('Could not save the operation'),
      },
    );
  };

  const submitSaveAs = (event: FormEvent) => {
    event.preventDefault();

    const name = saveAs.name.trim();
    if (!name || !saveAs.collectionId) {
      return;
    }

    createInto(saveAs.collectionId, name, () => setSaveAs({ open: false, name: '', collectionId: '' }));
  };

  const openSaveAs = () => {
    setSaveAs({
      open: true,
      // `operationName` reflects which operation the user selected when the
      // document holds several.
      name: suggestOperationName(queryEditor?.operationName, currentQuery()),
      // Only preselect a collection that is actually in the picker: the bound
      // one may be a team collection this user cannot write to, which would
      // leave Save enabled against an empty-looking Select and fail server-side.
      collectionId: editable.find((c) => c.id === activeBinding?.collectionId)?.id ?? editable[0]?.id ?? '',
    });
  };

  return (
    <>
      {/* A bookmark, deliberately not a floppy disk: the neighbouring Persist
          Operation button already owns the disk, and publishing to the registry
          and keeping a note for later are different enough to look different.
          GraphiQL's own toolbar classes keep it the same size and weight as the
          buttons either side. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="graphiql-toolbar-button"
                aria-label="Save operation"
                disabled={!hasOperation}
              >
                <FiSave className="graphiql-toolbar-icon" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="rounded-md border bg-background px-2 py-1">Save operation</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Collection</DropdownMenuLabel>
          {/* Save only appears once the tab is bound to a saved operation -
              until then there is nothing to update, only somewhere to put it. */}
          {activeBinding && (
            <DropdownMenuItem onSelect={() => saveExisting()} disabled={updateOperation.isPending}>
              Save
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={openSaveAs}>{activeBinding ? 'Save as' : 'Save to collection'}</DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* No label here: the separator already marks the break, and
              "Persist operation" says what it is on its own. */}
          <DropdownMenuItem onSelect={() => setPersistOpen(true)}>Persist operation</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PersistOperationDialog open={persistOpen} onOpenChange={setPersistOpen} query={currentQuery()} />

      <SaveOperationDialog
        open={saveAs.open}
        onOpenChange={(open) => setSaveAs((current) => ({ ...current, open, name: open ? current.name : '' }))}
        collections={editable}
        name={saveAs.name}
        onNameChange={(name) => setSaveAs((current) => ({ ...current, name }))}
        collectionId={saveAs.collectionId}
        onCollectionChange={(collectionId) => setSaveAs((current) => ({ ...current, collectionId }))}
        isPending={createOperation.isPending}
        onSubmit={submitSaveAs}
      />

      <SaveConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        serverVersion={serverVersion?.operation}
        onDiscardMine={(operation) => {
          if (!activeTabId) {
            return;
          }

          // Adopt their hash too, or the next save conflicts again.
          queryEditor?.setValue(operation.query);
          variableEditor?.setValue(operation.variables ?? '');
          advanceHash(activeTabId, operation.contentHash);
          setConflictOpen(false);
        }}
        onSaveAsNew={() => {
          setConflictOpen(false);
          openSaveAs();
        }}
      />
    </>
  );
};
