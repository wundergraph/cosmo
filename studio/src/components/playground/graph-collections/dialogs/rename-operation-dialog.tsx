import { useMutation } from '@connectrpc/connect-query';
import { renameGraphCollectionOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollectionOperationMeta } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { collectionMutationHandlers } from '@/lib/graph-collections';
import { NameDialog } from './name-dialog';

export const RenameOperationDialog = ({
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
  const { mutate, isPending } = useMutation(renameGraphCollectionOperation);

  return (
    <NameDialog
      title="Rename operation"
      description="This changes the label in this list. It does not change the operation name in the document."
      label="Name"
      submitLabel="Rename"
      initialName={operation.name}
      isPending={isPending}
      onClose={onClose}
      onSubmit={(name) =>
        mutate(
          { id: operation.id, name, federatedGraphId, collectionId },
          collectionMutationHandlers('Could not rename the operation', onDone),
        )
      }
    />
  );
};
