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
import { FormEvent, useState } from 'react';

/**
 * Prompts for a name. Used for renaming either a collection or an operation,
 * since both are the same interaction.
 *
 * Mounted only while open, so `initialName` seeds the state once per opening.
 */
export const NameDialog = ({
  title,
  description,
  label,
  initialName = '',
  submitLabel,
  isPending,
  onClose,
  onSubmit,
}: {
  title: string;
  description?: string;
  label: string;
  initialName?: string;
  submitLabel: string;
  isPending?: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) => {
  const [name, setName] = useState(initialName);

  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!trimmed || isPending) {
      return;
    }

    onSubmit(trimmed);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
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
            <Button type="button" variant="secondary" onClick={onClose}>
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
