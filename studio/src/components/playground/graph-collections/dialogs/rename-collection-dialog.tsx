import { useMutation } from '@connectrpc/connect-query';
import { renameGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useReducer } from 'react';
import { collectionMutationHandlers, teamNameConflict } from '@/lib/graph-collections';
import { NameDialog } from './name-dialog';

type RenameState = {
  name: string;
  /** The server's refusal, shown until the name changes. */
  serverError?: string;
};

type RenameAction = { type: 'SET_VALUE'; value: string } | { type: 'REFUSED'; details: string };

const renameReducer = (state: RenameState, action: RenameAction): RenameState => {
  switch (action.type) {
    case 'SET_VALUE':
      return { name: action.value, serverError: undefined };
    case 'REFUSED':
      return { ...state, serverError: action.details };
  }
};

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
  const [{ name, serverError }, dispatch] = useReducer(renameReducer, { name: collection.name });

  const nameConflict = collection.isTeamScoped ? teamNameConflict(collections, name, collection.id) : undefined;

  return (
    <NameDialog
      title="Rename collection"
      label="Name"
      submitLabel="Rename"
      initialName={collection.name}
      isPending={isPending}
      error={nameConflict ?? serverError}
      onNameChange={(value) => dispatch({ type: 'SET_VALUE', value })}
      onClose={onClose}
      onSubmit={(name) =>
        mutate(
          { id: collection.id, name, federatedGraphId },
          collectionMutationHandlers('Could not rename the collection', onDone, (details) =>
            dispatch({ type: 'REFUSED', details }),
          ),
        )
      }
    />
  );
};
