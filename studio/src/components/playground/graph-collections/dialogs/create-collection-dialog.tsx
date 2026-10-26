import { useMutation } from '@connectrpc/connect-query';
import { createGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { collectionMutationHandlers, MAX_COLLECTION_NAME_LENGTH } from '@/lib/graph-collections';
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
import { FormEvent, useState } from 'react';

/**
 * Creating a collection, with its scope chosen up front.
 *
 * Scope can be set here and promoted later, but never changed back, so the
 * choice is offered only at creation.
 */
export const CreateCollectionDialog = ({
  canCreateTeamCollection,
  federatedGraphName,
  namespace,
  onClose,
  onDone,
}: {
  /** False for anyone without write access to the graph; the option is then omitted. */
  canCreateTeamCollection: boolean;
  federatedGraphName: string;
  namespace: string;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { mutate, isPending } = useMutation(createGraphCollection);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'private' | 'team'>('private');

  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!trimmed || isPending) {
      return;
    }

    mutate(
      { federatedGraphName, namespace, name: trimmed, teamScoped: scope === 'team' },
      collectionMutationHandlers('Could not create the collection', onDone),
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
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
            <Button type="button" variant="secondary" onClick={onClose}>
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
