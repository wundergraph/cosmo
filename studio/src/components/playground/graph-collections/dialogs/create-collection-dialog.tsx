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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio';
import { FormEvent, useEffect, useState } from 'react';

/**
 * Creating a collection, with its scope chosen up front.
 *
 * Separate from the shared NameDialog because renames must not grow a scope
 * control: scope can be set at creation and promoted later, but never changed
 * back, so it belongs only where that choice is still open.
 */
export const CreateCollectionDialog = ({
  open,
  onOpenChange,
  canCreateTeamCollection,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False for anyone without write access to the graph; the option is then omitted. */
  canCreateTeamCollection: boolean;
  isPending?: boolean;
  onSubmit: (input: { name: string; teamScoped: boolean }) => void;
}) => {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'private' | 'team'>('private');

  // Reopening starts fresh rather than from whatever was abandoned last time.
  useEffect(() => {
    if (open) {
      setName('');
      setScope('private');
    }
  }, [open]);

  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!trimmed || isPending) {
      return;
    }

    onSubmit({ name: trimmed, teamScoped: scope === 'team' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="graph-collection-name">
                Name
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

            {/* Omitted entirely without write access: a permanently disabled
                option the reader can never use is just noise. */}
            {canCreateTeamCollection && (
              <div className="space-y-2">
                <span className="text-sm font-medium">Who can see it</span>
                <RadioGroup value={scope} onValueChange={(value) => setScope(value as 'private' | 'team')}>
                  <div className="flex items-start gap-x-2">
                    <RadioGroupItem value="private" id="graph-collection-scope-private" className="mt-0.5" />
                    <label htmlFor="graph-collection-scope-private" className="text-sm">
                      Private
                      <span className="block text-xs text-muted-foreground">Only you. You can share it later.</span>
                    </label>
                  </div>
                  <div className="flex items-start gap-x-2">
                    <RadioGroupItem value="team" id="graph-collection-scope-team" className="mt-0.5" />
                    <label htmlFor="graph-collection-scope-team" className="text-sm">
                      Team
                      <span className="block text-xs text-muted-foreground">
                        Everyone with access to this graph. This cannot be undone.
                      </span>
                    </label>
                  </div>
                </RadioGroup>
              </div>
            )}
          </div>

          {scope === 'team' && (
            <DialogDescription className="mb-2">A team collection cannot be made private again.</DialogDescription>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed} isLoading={isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
