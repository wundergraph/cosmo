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
 * Confirms a destructive action. `consequence` carries what is lost beyond the
 * thing named - a collection's delete says how many operations go with it.
 */
export const ConfirmDialog = ({
  title,
  description,
  consequence,
  confirmLabel,
  isPending,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  consequence?: string;
  confirmLabel: string;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) => {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{title}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{description}</DialogDescription>
        </DialogHeader>

        {consequence && <p className="my-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{consequence}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" isLoading={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
