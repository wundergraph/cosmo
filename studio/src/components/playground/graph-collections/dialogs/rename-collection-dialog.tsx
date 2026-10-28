import { useMutation } from '@connectrpc/connect-query';
import { renameGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { collectionMutationHandlers } from '@/lib/graph-collections';
import { NameDialog } from './name-dialog';

export const RenameCollectionDialog = ({
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
  const { mutate, isPending } = useMutation(renameGraphCollection);

  return (
    <NameDialog
      title="Rename collection"
      label="Name"
      submitLabel="Rename"
      initialName={collection.name}
      isPending={isPending}
      onClose={onClose}
      onSubmit={(name) =>
        mutate(
          { id: collection.id, name, federatedGraphId },
          collectionMutationHandlers('Could not rename the collection', onDone),
        )
      }
    />
  );
};
