import { MAX_COLLECTION_NAME_LENGTH } from '@/lib/graph-collections';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormEvent, useEffect, useState } from 'react';

/**
 * Prompts for a name. Used for creating a collection and for renaming either a
 * collection or an operation, since all three are the same interaction.
 */
export const NameDialog = ({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialName = '',
  submitLabel,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialName?: string;
  submitLabel: string;
  isPending?: boolean;
  onSubmit: (name: string) => void;
}) => {
  const [name, setName] = useState(initialName);

  // Reopening must start from the current value rather than whatever was typed
  // and abandoned last time.
  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!trimmed || isPending) {
      return;
    }

    onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="my-4 space-y-2">
            <label className="text-sm font-medium" htmlFor="graph-collection-name">
              {label}
            </label>
            <Input
              id="graph-collection-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_COLLECTION_NAME_LENGTH}
              placeholder="Cart operations"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed} isLoading={isPending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Confirms a destructive action. `consequence` carries what is lost beyond the
 * thing named - a collection's delete says how many operations go with it.
 */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  consequence,
  confirmLabel,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  consequence?: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: () => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {consequence && <p className="my-2 text-sm text-muted-foreground">{consequence}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
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

/**
 * Confirms promoting a private collection to team scope.
 *
 * Separate from ConfirmDialog because sharing is not destructive but *is*
 * irreversible, and the copy has to say both things it changes.
 */
export const ShareDialog = ({
  open,
  onOpenChange,
  collectionName,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string;
  isPending?: boolean;
  onConfirm: () => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share “{collectionName}” with the team?</DialogTitle>
          <DialogDescription>
            Everyone with access to this graph will be able to see this collection, and anyone who can edit the graph
            will be able to change its operations.
          </DialogDescription>
        </DialogHeader>

        <p className="my-2 text-sm text-muted-foreground">
          This cannot be undone. A shared collection cannot be made private again.
        </p>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" isLoading={isPending} onClick={onConfirm}>
            Share with team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
