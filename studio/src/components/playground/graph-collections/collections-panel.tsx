import { GraphiQLPlugin } from '@graphiql/react';
import { LuArrowDownUp, LuLayoutList } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { useToast } from '@/components/ui/use-toast';
import { ExclamationTriangleIcon, MagnifyingGlassIcon, PlusIcon } from '@radix-ui/react-icons';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import copy from 'copy-to-clipboard';
import { useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CollectionItem } from './collection-item';
import { useGraphCollectionsContext } from './graph-collections-provider';
import {
  buildCollectionShareUrl,
  CollectionSort,
  collectionDeepLinkParams,
  DeletedEntity,
  DialogState,
  filterCollections,
  resolveDeepLinkedCollection,
  resolveDeepLinkedOperation,
} from '@/lib/graph-collections';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CollectionDialogs } from './dialogs/collection-dialogs';
import { Tooltip } from '@/components/ui/tooltip';
import { TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { useGraphCollections } from '@/hooks/use-graph-collections';
import { useOpenOperation } from '@/hooks/use-open-operation';

export const CollectionsPanel = () => {
  const { toast } = useToast();

  const [{ collectionId: requestedCollectionId, operationId: requestedOperationId }, setDeepLink] =
    useQueryStates(collectionDeepLinkParams);

  // Declared before the query: the server does the ordering, so the sort is
  // part of its input.
  const [sort, setSort] = useState<CollectionSort>('name');

  const {
    collections,
    canCreateTeamCollection,
    isLoading,
    isError,
    refetch,
    federatedGraphName,
    namespace,
    federatedGraphId,
  } = useGraphCollections({ sort });
  const { boundOperationIds, hasOpenedDeepLink, markDeepLinkOpened } = useGraphCollectionsContext();

  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const deepLink = useMemo(
    () => resolveDeepLinkedCollection(collections, requestedCollectionId),
    [collections, requestedCollectionId],
  );

  const deepLinkedId = deepLink.status === 'found' ? deepLink.id : undefined;

  // A deep-linked collection opens expanded, on what the link named.
  useEffect(() => {
    if (deepLinkedId) {
      setExpanded((current) => ({ ...current, [deepLinkedId]: true }));
    }
  }, [deepLinkedId]);

  const copyLink = useCallback(
    (collectionId: string, operationId?: string) => {
      copy(buildCollectionShareUrl(window.location.origin, window.location.pathname, collectionId, operationId));
      toast({ description: 'Link copied', duration: 2000 });
    },
    [toast],
  );

  const closeDialog = useCallback(() => setDialog({ kind: 'none' }), []);

  /**
   * Refreshes the list, and drops a deep link to something that was just
   * deleted - otherwise the panel warns that the id is "unavailable", which
   * reads as a permission problem rather than the deletion the user performed.
   */
  const onChanged = useCallback(
    (deleted?: DeletedEntity) => {
      if (deleted?.kind === 'collection' && deleted.id === requestedCollectionId) {
        // A deleted collection takes its operations with it.
        setDeepLink({ collectionId: null, operationId: null });
      } else if (deleted?.kind === 'operation' && deleted.id === requestedOperationId) {
        setDeepLink({ operationId: null });
      }

      refetch();
    },
    [requestedCollectionId, requestedOperationId, setDeepLink, refetch],
  );

  const { openOperation: openSavedOperation, activeBinding } = useOpenOperation({
    onOperationMissing: refetch,
  });

  const openOperation = useCallback(
    (operationId: string, collectionId: string) => {
      // Keep the address bar describing what is on screen, so copying it shares it.
      setDeepLink({ collectionId, operationId });
      openSavedOperation(operationId, collectionId);
    },
    [setDeepLink, openSavedOperation],
  );

  // Arriving on a ?operationId=<id> link opens it once. Latched so that
  // closing the tab afterwards does not immediately reopen it.
  const deepLinkedOperation = useMemo(
    () => resolveDeepLinkedOperation(collections, requestedOperationId),
    [collections, requestedOperationId],
  );

  useEffect(() => {
    if (hasOpenedDeepLink || deepLinkedOperation.status !== 'found') {
      return;
    }

    markDeepLinkOpened();
    setExpanded((current) => ({ ...current, [deepLinkedOperation.collectionId]: true }));
    openOperation(deepLinkedOperation.operationId, deepLinkedOperation.collectionId);
  }, [hasOpenedDeepLink, markDeepLinkOpened, deepLinkedOperation, openOperation]);

  if (isLoading) {
    return <Loader />;
  }

  if (isError) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">Could not load collections.</p>
        <Button size="sm" variant="secondary" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const visible = filterCollections(collections, search);
  const isSearching = search.trim().length > 0;

  const privateCollections = visible.filter((collection) => !collection.isTeamScoped);
  const teamCollections = visible.filter((collection) => collection.isTeamScoped);

  const renderGroup = (title: string, group: GraphCollection[]) => {
    if (group.length === 0) {
      return null;
    }

    return (
      <div className="space-y-0.5">
        <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        {group.map((collection) => (
          <CollectionItem
            key={collection.id}
            collection={collection}
            isExpanded={isSearching || !!expanded[collection.id]}
            onToggle={() => {
              const nowExpanded = !expanded[collection.id];
              setExpanded((current) => ({ ...current, [collection.id]: nowExpanded }));

              // Removed again on collapse, so the URL never names something off screen.
              setDeepLink(nowExpanded ? { collectionId: collection.id } : { collectionId: null, operationId: null });
            }}
            onCopyLink={() => copyLink(collection.id)}
            boundOperationIds={boundOperationIds}
            activeOperationId={activeBinding?.operationId}
            onOpenOperation={(operation) => openOperation(operation.id, collection.id)}
            onCopyOperationLink={(operation) => copyLink(collection.id, operation.id)}
            onRename={() => setDialog({ kind: 'rename-collection', collection })}
            onShare={() => setDialog({ kind: 'share-collection', collection })}
            onDelete={() => setDialog({ kind: 'delete-collection', collection })}
            onRenameOperation={(operation) =>
              setDialog({ kind: 'rename-operation', operation, collectionId: collection.id })
            }
            onDeleteOperation={(operation) =>
              setDialog({ kind: 'delete-operation', operation, collectionId: collection.id })
            }
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between gap-x-2">
        <span className="graph-collections-header truncate">Collections</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              aria-label="New collection"
              onClick={() => setDialog({ kind: 'create' })}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="rounded-md border bg-background px-2 py-1">New collection</TooltipContent>
        </Tooltip>
      </div>

      {/* Only worth the space once there is enough here to lose track of. */}
      {collections.length > 1 && (
        <div className="mb-3 flex items-center gap-x-1">
          <div className="graph-collections-search min-w-0 flex-1">
            <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label="Search collections and operations"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="Sort collections">
                <LuArrowDownUp />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(value) => setSort(value as CollectionSort)}>
                <DropdownMenuRadioItem className="justify-between gap-x-6 pl-2" value="name">
                  Name
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem className="justify-between gap-x-6 pl-2" value="createdAt">
                  Date created
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Covers the operation as well as the collection. A link can name an
          operation that the opener cannot see (a private collection, or one
          deleted since), and saying nothing leaves them staring at a playground
          that silently ignored their link. */}
      {(deepLink.status === 'unavailable' || deepLinkedOperation.status === 'unavailable') && (
        <div className="mb-3 flex items-start gap-x-2 rounded border border-dashed p-2 text-xs text-muted-foreground">
          <ExclamationTriangleIcon className="mt-0.5 h-3 w-3 shrink-0" />
          {/* One message for missing, wrong-graph and not-permitted: the
              server cannot tell them apart, and neither should this. */}
          <span>
            {deepLinkedOperation.status === 'unavailable'
              ? 'This operation is unavailable. It may have been deleted, or you may not have access to it.'
              : 'This collection is unavailable. It may have been deleted, or you may not have access to it.'}
          </span>
        </div>
      )}

      {/* `scrollbar-custom` is the studio-wide thin scrollbar from globals.css,
          the same one the body and every other scrolling pane use. Without it
          this list gets the platform default, which is far heavier than
          anything else in the playground.

          `pr-2` keeps a row's hover highlight off the scrollbar: they are both
          flush right otherwise, and the highlight reads as if it is bleeding
          into the track. */}
      <div className="scrollbar-custom flex-1 space-y-3 overflow-y-auto pr-2">
        {isSearching && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No collections or operations match “{search.trim()}”.</p>
        ) : collections.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Collections keep the operations you want to come back to. Create one, then save the current operation into
              it from the bookmark button in the toolbar.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'create' })}>
              New collection
            </Button>
          </div>
        ) : (
          <>
            {renderGroup('Private', privateCollections)}
            {renderGroup('Team', teamCollections)}
          </>
        )}
      </div>

      <CollectionDialogs
        dialog={dialog}
        closeDialog={closeDialog}
        onChanged={onChanged}
        canCreateTeamCollection={canCreateTeamCollection}
        federatedGraphName={federatedGraphName}
        namespace={namespace}
        federatedGraphId={federatedGraphId}
      />
    </div>
  );
};

/**
 * The panel, registered with GraphiQL.
 *
 * Defined once at module scope. GraphiQL throws when two plugins share a title
 * and re-registers whenever the object identity changes, so this must not be
 * rebuilt per render.
 */
export const collectionsPlugin: GraphiQLPlugin = {
  title: 'Collections',
  icon: function CollectionsIcon() {
    return <LuLayoutList />;
  },
  content: CollectionsPanel,
};
