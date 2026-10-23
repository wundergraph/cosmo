import { useMutation } from '@connectrpc/connect-query';
import { shareGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { collectionMutationHandlers } from '@/lib/graph-collections';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Confirms promoting a private collection to team scope.
 *
 * Sharing is not destructive but is irreversible, so the copy names both of
 * the things it changes and says that it cannot be undone.
 */
export const ShareCollectionDialog = ({
  collection,
  federatedGraphId,
  onClose,
  onDone,
}: {
  collection: GraphCollection;
  federatedGraphId: string;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { mutate, isPending } = useMutation(shareGraphCollection);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader className="pr-6">
          <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
            Share “{collection.name}” with the team?
          </DialogTitle>
          <DialogDescription>
            Everyone with access to this graph will be able to see this collection, and anyone who can edit the graph
            will be able to change its operations.
          </DialogDescription>
        </DialogHeader>

        <p className="my-2 text-sm text-muted-foreground">
          This cannot be undone. A shared collection cannot be made private again.
        </p>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            isLoading={isPending}
            onClick={() =>
              mutate(
                { id: collection.id, federatedGraphId },
                collectionMutationHandlers('Could not share the collection', onDone),
              )
            }
          >
            Share with team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
