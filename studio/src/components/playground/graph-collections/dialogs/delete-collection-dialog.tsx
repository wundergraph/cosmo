import { useMutation } from '@connectrpc/connect-query';
import { deleteGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { collectionMutationHandlers } from '@/lib/graph-collections';
import { ConfirmDialog } from './confirm-dialog';

/** What goes with the collection, beyond the collection itself. */
const consequenceOf = (collection: GraphCollection): string | undefined => {
  const { length } = collection.operations;

  const operations =
    length > 0 ? `${length} saved ${length === 1 ? 'operation' : 'operations'} will be deleted with it.` : '';
  const shared = collection.isTeamScoped ? 'This collection is shared with your team.' : '';

  return [operations, shared].filter(Boolean).join(' ') || undefined;
};

export const DeleteCollectionDialog = ({
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
  const { mutate, isPending } = useMutation(deleteGraphCollection);

  return (
    <ConfirmDialog
      title="Delete collection"
      description={`“${collection.name}” will be deleted permanently.`}
      consequence={consequenceOf(collection)}
      confirmLabel="Delete"
      isPending={isPending}
      onClose={onClose}
      onConfirm={() =>
        mutate(
          { id: collection.id, federatedGraphId },
          collectionMutationHandlers('Could not delete the collection', onDone),
        )
      }
    />
  );
};
