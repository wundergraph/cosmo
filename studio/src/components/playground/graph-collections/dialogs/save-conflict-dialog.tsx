import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GraphCollectionOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

/**
 * Shown when a save was rejected because someone else saved first. Nothing is
 * merged: the user either keeps their work under a new name, or takes the
 * stored version. The save is already rejected, so neither choice loses work.
 */
export const SaveConflictDialog = ({
  open,
  onOpenChange,
  serverVersion,
  onDiscardMine,
  onSaveAsNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined while the stored version is still being fetched. */
  serverVersion: GraphCollectionOperation | undefined;
  onDiscardMine: (operation: GraphCollectionOperation) => void;
  onSaveAsNew: () => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This operation changed while you were editing it</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            {serverVersion?.updatedByEmail
              ? `${serverVersion.updatedByEmail} saved a different version after you opened this one.`
              : 'Someone saved a different version after you opened this one.'}{' '}
            Your changes were not saved, and theirs were left untouched.
          </DialogDescription>
        </DialogHeader>

        <p className="my-2 text-sm text-muted-foreground">
          Nothing is merged automatically. Keep your work as a new operation, or discard it and load theirs.
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            // The stored version is still in flight right after the conflict;
            // without this the button is clickable and does nothing.
            disabled={!serverVersion}
            onClick={() => serverVersion && onDiscardMine(serverVersion)}
          >
            Discard mine and reload
          </Button>
          <Button type="button" onClick={onSaveAsNew}>
            Save as a new operation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
