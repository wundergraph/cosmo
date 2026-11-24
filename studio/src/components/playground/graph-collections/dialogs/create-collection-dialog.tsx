import { useMutation } from '@connectrpc/connect-query';
import { createGraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { collectionMutationHandlers, MAX_COLLECTION_NAME_LENGTH, teamNameConflict } from '@/lib/graph-collections';
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
import { GraphCollection } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FormEvent, useReducer } from 'react';

type CreateState = {
  name: string;
  scope: 'private' | 'team';
  /** The server's refusal, shown until the name or scope changes. */
  serverError?: string;
};

type CreateAction =
  | { type: 'SET_VALUE'; value: string }
  | { type: 'SET_SCOPE'; scope: CreateState['scope'] }
  | { type: 'REFUSED'; details: string };

const createReducer = (state: CreateState, action: CreateAction): CreateState => {
  switch (action.type) {
    case 'SET_VALUE':
      return { ...state, name: action.value, serverError: undefined };
    case 'SET_SCOPE':
      return { ...state, scope: action.scope, serverError: undefined };
    case 'REFUSED':
      return { ...state, serverError: action.details };
  }
};

/**
 * Creating a collection, with its scope chosen up front.
 *
 * Scope can be set here and promoted later, but never changed back, so the
 * choice is offered only at creation.
 */
export const CreateCollectionDialog = ({
  canCreateTeamCollection,
  collections,
  federatedGraphName,
  namespace,
  onClose,
  onDone,
}: {
  /** False for anyone without write access to the graph; the option is then omitted. */
  canCreateTeamCollection: boolean;
  /** Every collection the user can see, to catch a team name clash before submitting. */
  collections: GraphCollection[];
  federatedGraphName: string;
  namespace: string;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { mutate, isPending } = useMutation(createGraphCollection);
  const [{ name, scope, serverError }, dispatch] = useReducer(createReducer, { name: '', scope: 'private' });

  const trimmed = name.trim();
  const nameConflict = scope === 'team' ? teamNameConflict(collections, trimmed) : undefined;
  const error = nameConflict ?? serverError;

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!trimmed || isPending || error) {
      return;
    }

    mutate(
      { federatedGraphName, namespace, name: trimmed, teamScoped: scope === 'team' },
      collectionMutationHandlers('Could not create the collection', onDone, (details) =>
        dispatch({ type: 'REFUSED', details }),
      ),
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
                // Name and scope are locked while saving, so a late refusal always matches the form.
                disabled={isPending}
                value={name}
                onChange={(event) => dispatch({ type: 'SET_VALUE', value: event.target.value })}
                maxLength={MAX_COLLECTION_NAME_LENGTH}
                placeholder="Cart operations"
                aria-invalid={!!error}
                aria-describedby={error ? 'graph-collection-name-error' : undefined}
              />
              {error && (
                <p id="graph-collection-name-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>

            {canCreateTeamCollection && (
              <div className="space-y-2">
                <span className="text-sm font-medium">Who can see it</span>
                <RadioGroup
                  disabled={isPending}
                  value={scope}
                  onValueChange={(value) => dispatch({ type: 'SET_SCOPE', scope: value as CreateState['scope'] })}
                >
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
            <Button type="submit" disabled={!trimmed || !!error} isLoading={isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
