import { useCallback } from 'react';
import { DeletedEntity, DialogState } from '@/lib/graph-collections';
import { CreateCollectionDialog } from './create-collection-dialog';
import { DeleteCollectionDialog } from './delete-collection-dialog';
import { DeleteOperationDialog } from './delete-operation-dialog';
import { RenameCollectionDialog } from './rename-collection-dialog';
import { RenameOperationDialog } from './rename-operation-dialog';
import { ShareCollectionDialog } from './share-collection-dialog';

/**
 * Renders whichever dialog the collections panel has raised, and only that one.
 *
 * Each dialog seeds its state from props on mount, so an abandoned draft does
 * not survive into the next opening.
 */
export const CollectionDialogs = ({
  dialog,
  closeDialog,
  onChanged,
  canCreateTeamCollection,
  federatedGraphName,
  namespace,
  federatedGraphId,
}: {
  dialog: DialogState;
  closeDialog: () => void;
  canCreateTeamCollection: boolean;
  onChanged: (deleted?: DeletedEntity) => void;
  federatedGraphName: string;
  namespace: string;
  federatedGraphId: string;
}) => {
  const onDone = useCallback(
    (deleted?: DeletedEntity) => {
      closeDialog();
      onChanged(deleted);
    },
    [closeDialog, onChanged],
  );

  switch (dialog.kind) {
    case 'none': {
      return null;
    }

    case 'create': {
      return (
        <CreateCollectionDialog
          canCreateTeamCollection={canCreateTeamCollection}
          federatedGraphName={federatedGraphName}
          namespace={namespace}
          onClose={closeDialog}
          onDone={onDone}
        />
      );
    }

    case 'rename-collection': {
      return (
        <RenameCollectionDialog
          collection={dialog.collection}
          federatedGraphId={federatedGraphId}
          onClose={closeDialog}
          onDone={onDone}
        />
      );
    }

    case 'delete-collection': {
      return (
        <DeleteCollectionDialog
          collection={dialog.collection}
          federatedGraphId={federatedGraphId}
          onClose={closeDialog}
          onDone={() => onDone({ kind: 'collection', id: dialog.collection.id })}
        />
      );
    }

    case 'share-collection': {
      return (
        <ShareCollectionDialog
          collection={dialog.collection}
          federatedGraphId={federatedGraphId}
          onClose={closeDialog}
          onDone={onDone}
        />
      );
    }

    case 'rename-operation': {
      return (
        <RenameOperationDialog
          operation={dialog.operation}
          collectionId={dialog.collectionId}
          federatedGraphId={federatedGraphId}
          onClose={closeDialog}
          onDone={onDone}
        />
      );
    }

    case 'delete-operation': {
      return (
        <DeleteOperationDialog
          operation={dialog.operation}
          collectionId={dialog.collectionId}
          federatedGraphId={federatedGraphId}
          onClose={closeDialog}
          onDone={() => onDone({ kind: 'operation', id: dialog.operation.id })}
        />
      );
    }
  }
};
