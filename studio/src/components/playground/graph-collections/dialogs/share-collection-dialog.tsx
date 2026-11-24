import { useMutation } from '@connectrpc/connect-query';
import {
  renameGraphCollection,
  shareGraphCollection,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FormEvent, useReducer } from 'react';
import {
  collectionMutationHandlers,
  MAX_COLLECTION_NAME_LENGTH,
  teamNameConflict,
  teamNameTakenMessage,
} from '@/lib/graph-collections';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type ShareState = {
  /** Whether the dialog asks for a new name, because a team collection already uses this one. */
  needsNewName: boolean;
  /** The name in the field. */
  name: string;
  /** The name as last saved. A rename can succeed and the share then fail, so it can differ from `collection.name`. */
  savedName: string;
  /** The server's refusal, shown until the name changes. */
  serverError?: string;
};

type ShareAction =
  | { type: 'SET_VALUE'; value: string }
  | { type: 'RENAMED'; name: string }
  | { type: 'RENAME_REFUSED'; details: string }
  | { type: 'SHARE_REFUSED'; name: string };

const shareReducer = (state: ShareState, action: ShareAction): ShareState => {
  switch (action.type) {
    case 'SET_VALUE':
      return { ...state, name: action.value, serverError: undefined };
    case 'RENAMED':
      return { ...state, savedName: action.name };
    case 'RENAME_REFUSED':
      return { ...state, serverError: action.details };
    case 'SHARE_REFUSED':
      return { ...state, needsNewName: true, serverError: teamNameTakenMessage(action.name) };
  }
};

/**
 * Confirms promoting a private collection to team scope.
 *
 * Sharing is not destructive but is irreversible, so the copy names both of
 * the things it changes and says that it cannot be undone.
 *
 * Team names are unique per graph, so when this name is already taken the
 * dialog asks for a new one, then renames the private collection and shares it.
 * Renaming a private collection can never clash, so only the share can fail.
 */
export const ShareCollectionDialog = ({
  collection,
  collections,
  federatedGraphId,
  onClose,
  onDone,
}: {
  collection: GraphCollection;
  /** Every collection the user can see, to catch a team name clash before submitting. */
  collections: GraphCollection[];
  federatedGraphId: string;
  onClose: () => void;
  onDone: () => void;
}) => {
  const share = useMutation(shareGraphCollection);
  const rename = useMutation(renameGraphCollection);

  const [{ needsNewName, name, savedName, serverError }, dispatch] = useReducer(shareReducer, undefined, () => ({
    needsNewName: teamNameConflict(collections, collection.name, collection.id) !== undefined,
    name: collection.name,
    savedName: collection.name,
  }));

  const trimmed = name.trim();
  const nameConflict = needsNewName ? teamNameConflict(collections, trimmed, collection.id) : undefined;
  const error = nameConflict ?? serverError;
  const isPending = share.isPending || rename.isPending;

  const shareNow = () =>
    share.mutate(
      { id: collection.id, federatedGraphId },
      // The list was out of date: someone took the name since it loaded.
      collectionMutationHandlers('Could not share the collection', onDone, () =>
        dispatch({ type: 'SHARE_REFUSED', name: trimmed }),
      ),
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (isPending || error || !trimmed) {
      return;
    }

    if (!needsNewName || trimmed === savedName) {
      shareNow();
      return;
    }

    rename.mutate(
      { id: collection.id, name: trimmed, federatedGraphId },
      collectionMutationHandlers(
        'Could not rename the collection',
        () => {
          dispatch({ type: 'RENAMED', name: trimmed });
          shareNow();
        },
        (details) => dispatch({ type: 'RENAME_REFUSED', details }),
      ),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader className="pr-6">
            <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
              Share “{collection.name}” with the team?
            </DialogTitle>
            <DialogDescription>
              Everyone with access to this graph will be able to see this collection, and anyone who can edit the graph
              will be able to change its operations.
            </DialogDescription>
          </DialogHeader>

          {needsNewName && (
            <div className="my-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                Team collections need unique names. Choose a new name to share this one.
              </p>
              <label className="text-sm font-medium" htmlFor="graph-collection-share-name">
                Name
              </label>
              <Input
                id="graph-collection-share-name"
                autoFocus
                disabled={isPending}
                value={name}
                onChange={(event) => dispatch({ type: 'SET_VALUE', value: event.target.value })}
                maxLength={MAX_COLLECTION_NAME_LENGTH}
                aria-invalid={!!error}
                aria-describedby={error ? 'graph-collection-share-name-error' : undefined}
              />
              {error && (
                <p id="graph-collection-share-name-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          <p className="my-2 text-sm text-muted-foreground">
            This cannot be undone. A shared collection cannot be made private again.
          </p>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || !!error} isLoading={isPending}>
              {needsNewName ? 'Rename and share' : 'Share with team'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
