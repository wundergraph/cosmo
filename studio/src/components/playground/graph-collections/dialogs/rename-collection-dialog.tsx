import { useMutation } from '@connectrpc/connect-query';
import { renameGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useState } from 'react';
import { collectionMutationHandlers, teamNameTaken, teamNameTakenMessage } from '@/lib/graph-collections';
import { NameDialog } from './name-dialog';

export const RenameCollectionDialog = ({
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
  const { mutate, isPending } = useMutation(renameGraphCollection);
  const [name, setName] = useState(collection.name);
  const [serverError, setServerError] = useState<string>();

  const clash =
    collection.isTeamScoped && teamNameTaken(collections, name, collection.id) ? teamNameTakenMessage(name) : undefined;

  return (
    <NameDialog
      title="Rename collection"
      label="Name"
      submitLabel="Rename"
      initialName={collection.name}
      isPending={isPending}
      error={clash ?? serverError}
      onNameChange={(next) => {
        setName(next);
        setServerError(undefined);
      }}
      onClose={onClose}
      onSubmit={(trimmed) =>
        mutate(
          { id: collection.id, name: trimmed, federatedGraphId },
          collectionMutationHandlers('Could not rename the collection', onDone, setServerError),
        )
      }
    />
  );
};
