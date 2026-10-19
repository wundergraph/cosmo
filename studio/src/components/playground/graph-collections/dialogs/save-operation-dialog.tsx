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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FormEvent } from 'react';

/**
 * Chooses a collection and a name for a new saved operation.
 *
 * Controlled by the toolbar rather than holding its own draft: the same dialog
 * is opened both by "Save as" and by the conflict dialog's "Save as a new
 * operation", and the second needs the name pre-filled from the editor.
 */
export const SaveOperationDialog = ({
  open,
  onOpenChange,
  collections,
  name,
  onNameChange,
  collectionId,
  onCollectionChange,
  isPending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only collections the user may write to; the caller filters. */
  collections: GraphCollection[];
  name: string;
  onNameChange: (name: string) => void;
  collectionId: string;
  onCollectionChange: (collectionId: string) => void;
  isPending?: boolean;
  onSubmit: (event: FormEvent) => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="min-w-0">
          <DialogHeader>
            <DialogTitle>Save operation</DialogTitle>
            <DialogDescription>
              Saves the current query and variables. Headers are not saved. Set those as default headers instead.
            </DialogDescription>
          </DialogHeader>

          {collections.length === 0 ? (
            <p className="my-4 text-sm text-muted-foreground">
              You do not have a collection you can write to yet. Create one from the Collections panel first.
            </p>
          ) : (
            <div className="my-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="graph-collection-target">
                  Collection
                </label>
                <Select value={collectionId} onValueChange={onCollectionChange}>
                  <SelectTrigger
                    id="graph-collection-target"
                    className="min-w-0 [&>span>p]:overflow-hidden [&>span>p]:text-ellipsis [&>span>p]:whitespace-nowrap [&>span]:truncate"
                  >
                    <SelectValue placeholder="Choose a collection" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[--radix-select-trigger-width]">
                    {collections.map((collection) => (
                      <SelectItem
                        key={collection.id}
                        value={collection.id}
                        className="max-w-[calc(var(--radix-select-trigger-width)_-_0.5rem)] [&>p]:overflow-hidden [&>p]:text-ellipsis [&>p]:whitespace-nowrap"
                      >
                        <span title={collection.name}>
                          {collection.name}
                          {collection.isTeamScoped ? ' (team)' : ''}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="graph-collection-operation-name">
                  Name
                </label>
                <Input
                  id="graph-collection-operation-name"
                  autoFocus
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  maxLength={MAX_COLLECTION_NAME_LENGTH}
                  placeholder="Cart totals"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !collectionId} isLoading={isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
