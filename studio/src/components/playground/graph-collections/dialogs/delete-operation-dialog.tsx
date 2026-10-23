import { useMutation } from '@connectrpc/connect-query';
import { deleteGraphCollectionOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollectionOperationMeta } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { collectionMutationHandlers } from '@/lib/graph-collections';
import { ConfirmDialog } from './confirm-dialog';

export const DeleteOperationDialog = ({
  operation,
  collectionId,
  federatedGraphId,
  onClose,
  onDone,
}: {
  operation: GraphCollectionOperationMeta;
  /** The server scopes every by-id call to the owning collection. */
  collectionId: string;
  federatedGraphId: string;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { mutate, isPending } = useMutation(deleteGraphCollectionOperation);

  return (
    <ConfirmDialog
      title="Delete operation"
      description={`“${operation.name}” will be deleted.`}
      confirmLabel="Delete"
      isPending={isPending}
      onClose={onClose}
      onConfirm={() =>
        mutate(
          { id: operation.id, federatedGraphId, collectionId },
          collectionMutationHandlers('Could not delete the operation', onDone),
        )
      }
    />
  );
};
