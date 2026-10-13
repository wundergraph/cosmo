import { useMutation } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  createGraphCollection,
  deleteGraphCollection,
  deleteGraphCollectionOperation,
  renameGraphCollection,
  renameGraphCollectionOperation,
  shareGraphCollection,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useCallback } from 'react';
import { ConfirmDialog, NameDialog, ShareDialog } from './shared-dialogs';
import { CreateCollectionDialog } from './create-collection-dialog';
import { DialogState, reportFailure } from '@/lib/graph-collections';

/**
 * Every dialog the collections panel can raise, and the mutations behind them.
 * Split out so the panel renders a tree and nothing else.
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
  /** Called after a successful mutation, to refresh the list. */
  onChanged: () => void;
  federatedGraphName: string;
  namespace: string;
  federatedGraphId: string;
}) => {
  const createCollectionMutation = useMutation(createGraphCollection);
  const renameCollectionMutation = useMutation(renameGraphCollection);
  const shareCollectionMutation = useMutation(shareGraphCollection);
  const deleteCollectionMutation = useMutation(deleteGraphCollection);
  const renameOperationMutation = useMutation(renameGraphCollectionOperation);
  const deleteOperationMutation = useMutation(deleteGraphCollectionOperation);

  const afterChange = useCallback(() => {
    closeDialog();
    onChanged();
  }, [closeDialog, onChanged]);

  return (
    <>
      <CreateCollectionDialog
        open={dialog.kind === 'create'}
        onOpenChange={(open) => !open && closeDialog()}
        canCreateTeamCollection={canCreateTeamCollection}
        isPending={createCollectionMutation.isPending}
        onSubmit={({ name, teamScoped }) =>
          createCollectionMutation.mutate(
            { federatedGraphName, namespace, name, teamScoped },
            {
              onSuccess: ({ response }) => {
                if (response?.code !== EnumStatusCode.OK) {
                  reportFailure('Could not create the collection', response?.details);
                  return;
                }
                afterChange();
              },
              onError: () => reportFailure('Could not create the collection'),
            },
          )
        }
      />

      <NameDialog
        open={dialog.kind === 'rename-collection'}
        onOpenChange={(open) => !open && closeDialog()}
        title="Rename collection"
        label="Name"
        submitLabel="Rename"
        initialName={dialog.kind === 'rename-collection' ? dialog.collection.name : ''}
        isPending={renameCollectionMutation.isPending}
        onSubmit={(name) => {
          if (dialog.kind !== 'rename-collection') {
            return;
          }

          renameCollectionMutation.mutate(
            { id: dialog.collection.id, name, federatedGraphId },
            {
              onSuccess: ({ response }) => {
                if (response?.code !== EnumStatusCode.OK) {
                  reportFailure('Could not rename the collection', response?.details);
                  return;
                }
                afterChange();
              },
              onError: () => reportFailure('Could not rename the collection'),
            },
          );
        }}
      />

      <NameDialog
        open={dialog.kind === 'rename-operation'}
        onOpenChange={(open) => !open && closeDialog()}
        title="Rename operation"
        description="This changes the label in this list. It does not change the operation name in the document."
        label="Name"
        submitLabel="Rename"
        initialName={dialog.kind === 'rename-operation' ? dialog.operation.name : ''}
        isPending={renameOperationMutation.isPending}
        onSubmit={(name) => {
          if (dialog.kind !== 'rename-operation') {
            return;
          }

          renameOperationMutation.mutate(
            { id: dialog.operation.id, name, federatedGraphId, collectionId: dialog.collectionId },
            {
              onSuccess: ({ response }) => {
                if (response?.code !== EnumStatusCode.OK) {
                  reportFailure('Could not rename the operation', response?.details);
                  return;
                }
                afterChange();
              },
              onError: () => reportFailure('Could not rename the operation'),
            },
          );
        }}
      />

      <ConfirmDialog
        open={dialog.kind === 'delete-collection'}
        onOpenChange={(open) => !open && closeDialog()}
        title="Delete collection"
        description={
          dialog.kind === 'delete-collection' ? `“${dialog.collection.name}” will be deleted permanently.` : ''
        }
        consequence={
          dialog.kind === 'delete-collection' && dialog.collection.operations.length > 0
            ? `${dialog.collection.operations.length} saved ${
                dialog.collection.operations.length === 1 ? 'operation' : 'operations'
              } will be deleted with it.${
                dialog.collection.isTeamScoped ? ' This collection is shared with your team.' : ''
              }`
            : dialog.kind === 'delete-collection' && dialog.collection.isTeamScoped
              ? 'This collection is shared with your team.'
              : undefined
        }
        confirmLabel="Delete"
        isPending={deleteCollectionMutation.isPending}
        onConfirm={() => {
          if (dialog.kind !== 'delete-collection') {
            return;
          }

          deleteCollectionMutation.mutate(
            { id: dialog.collection.id, federatedGraphId },
            {
              onSuccess: ({ response }) => {
                if (response?.code !== EnumStatusCode.OK) {
                  reportFailure('Could not delete the collection', response?.details);
                  return;
                }
                afterChange();
              },
              onError: () => reportFailure('Could not delete the collection'),
            },
          );
        }}
      />

      <ConfirmDialog
        open={dialog.kind === 'delete-operation'}
        onOpenChange={(open) => !open && closeDialog()}
        title="Delete operation"
        description={dialog.kind === 'delete-operation' ? `“${dialog.operation.name}” will be deleted.` : ''}
        confirmLabel="Delete"
        isPending={deleteOperationMutation.isPending}
        onConfirm={() => {
          if (dialog.kind !== 'delete-operation') {
            return;
          }

          deleteOperationMutation.mutate(
            { id: dialog.operation.id, federatedGraphId, collectionId: dialog.collectionId },
            {
              onSuccess: ({ response }) => {
                if (response?.code !== EnumStatusCode.OK) {
                  reportFailure('Could not delete the operation', response?.details);
                  return;
                }
                afterChange();
              },
              onError: () => reportFailure('Could not delete the operation'),
            },
          );
        }}
      />

      <ShareDialog
        open={dialog.kind === 'share-collection'}
        onOpenChange={(open) => !open && closeDialog()}
        collectionName={dialog.kind === 'share-collection' ? dialog.collection.name : ''}
        isPending={shareCollectionMutation.isPending}
        onConfirm={() => {
          if (dialog.kind !== 'share-collection') {
            return;
          }

          shareCollectionMutation.mutate(
            { id: dialog.collection.id, federatedGraphId },
            {
              onSuccess: ({ response }) => {
                if (response?.code !== EnumStatusCode.OK) {
                  reportFailure('Could not share the collection', response?.details);
                  return;
                }
                afterChange();
              },
              onError: () => reportFailure('Could not share the collection'),
            },
          );
        }}
      />
    </>
  );
};
