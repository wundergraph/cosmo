import { useMutation } from '@connectrpc/connect-query';
import {
  renameGraphCollection,
  shareGraphCollection,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FormEvent, useState } from 'react';
import {
  collectionMutationHandlers,
  MAX_COLLECTION_NAME_LENGTH,
  teamNameTaken,
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

  const [needsNewName, setNeedsNewName] = useState(() => teamNameTaken(collections, collection.name, collection.id));
  const [name, setName] = useState(collection.name);
  const [savedName, setSavedName] = useState(collection.name);
  const [serverError, setServerError] = useState<string>();

  const trimmed = name.trim();
  const clash =
    needsNewName && teamNameTaken(collections, trimmed, collection.id) ? teamNameTakenMessage(trimmed) : undefined;
  const error = clash ?? serverError;
  const isPending = share.isPending || rename.isPending;

  const shareNow = () =>
    share.mutate(
      { id: collection.id, federatedGraphId },
      // The list was out of date: someone took the name since it loaded.
      collectionMutationHandlers('Could not share the collection', onDone, () => {
        setNeedsNewName(true);
        setServerError(teamNameTakenMessage(trimmed));
      }),
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
          setSavedName(trimmed);
          shareNow();
        },
        setServerError,
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
                onChange={(event) => {
                  setName(event.target.value);
                  setServerError(undefined);
                }}
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
