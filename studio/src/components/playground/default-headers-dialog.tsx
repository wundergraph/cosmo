import { GraphContext } from '@/components/layout/graph-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Loader } from '@/components/ui/loader';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { DefaultHeaderEntry, effectiveDefaultHeadersString, isValidHeaderName } from '@/lib/playground-headers';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { InfoCircledIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getPlaygroundDefaultHeaders,
  updatePlaygroundDefaultHeaders,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useContext, useState } from 'react';
import { LuSettings2 } from 'react-icons/lu';

interface HeaderRowsProps {
  entries: DefaultHeaderEntry[];
  disabled?: boolean;
  onChange: (entries: DefaultHeaderEntry[]) => void;
}

// A blank key is a row the user has not filled in yet, not an error - it is
// filtered out before saving.
// Strips the protobuf message wrapper down to the plain entries the editor uses.
const fromServer = (headers?: { key: string; value: string }[]): DefaultHeaderEntry[] =>
  (headers ?? []).map((h) => ({ key: h.key, value: h.value }));

const isInvalidKey = (entry: DefaultHeaderEntry) => entry.key.trim() !== '' && !isValidHeaderName(entry.key);

const HeaderRows = ({ entries, disabled = false, onChange }: HeaderRowsProps) => {
  const update = (index: number, patch: Partial<DefaultHeaderEntry>) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  return (
    <div className="flex flex-col gap-y-2">
      {entries.map((entry, index) => {
        const isInvalid = isInvalidKey(entry);

        return (
          <div key={index} className="flex items-start gap-x-2">
            <div className="flex-1">
              <Input
                aria-label="Header name"
                placeholder="Header name"
                value={entry.key}
                disabled={disabled}
                onChange={(e) => update(index, { key: e.target.value })}
                className={isInvalid ? 'border-destructive' : undefined}
              />
              {isInvalid && <p className="mt-1 text-xs text-destructive">Not a valid HTTP header name</p>}
            </div>
            <Input
              aria-label="Header value"
              placeholder="Value"
              value={entry.value}
              disabled={disabled}
              onChange={(e) => update(index, { value: e.target.value })}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove header"
              disabled={disabled}
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <TrashIcon className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...entries, { key: '', value: '' }])}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add header
        </Button>
      </div>
    </div>
  );
};

export const DefaultHeadersDialog = () => {
  const graphContext = useContext(GraphContext);
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);

  // Null means "not edited in this session", in which case the server's values are
  // shown. Any edit replaces the draft, and from then on nothing but the user can
  // change it - so a background refetch cannot clobber work in progress. Both are
  // reset to null on close, so the next open starts from fresh server data.
  const [personalDraft, setPersonalDraft] = useState<DefaultHeaderEntry[] | null>(null);
  const [graphDraft, setGraphDraft] = useState<DefaultHeaderEntry[] | null>(null);

  const federatedGraphName = graphContext?.graph?.name ?? '';
  const namespace = graphContext?.graph?.namespace ?? '';

  const {
    data,
    isPending: isLoading,
    isError,
    refetch,
  } = useQuery(
    getPlaygroundDefaultHeaders,
    { federatedGraphName, namespace },
    { enabled: !!federatedGraphName, retry: 1, staleTime: 5 * 60 * 1000 },
  );

  const { mutate, isPending } = useMutation(updatePlaygroundDefaultHeaders);

  const personalEntries = personalDraft ?? fromServer(data?.personalHeaders);
  const graphEntries = graphDraft ?? fromServer(data?.graphHeaders);

  const canEditGraphHeaders = data?.canEditGraphHeaders ?? false;
  const preview = effectiveDefaultHeadersString(graphEntries, personalEntries);

  // Only gate Save on rows the user can actually fix. The graph rows are read-only
  // for a non-admin and `save` omits them from the request entirely, so letting them
  // disable Save would strand the user with no way to save their own headers.
  const hasInvalidKey = personalEntries.some(isInvalidKey) || (canEditGraphHeaders && graphEntries.some(isInvalidKey));

  const save = () => {
    const toHeaders = (entries: DefaultHeaderEntry[]) => ({
      headers: entries.filter((entry) => entry.key.trim() !== ''),
    });

    mutate(
      {
        federatedGraphName,
        namespace,
        personalHeaders: toHeaders(personalEntries),
        ...(canEditGraphHeaders ? { graphHeaders: toHeaders(graphEntries) } : {}),
      },
      {
        onSuccess: ({ response }) => {
          if (response?.code !== EnumStatusCode.OK) {
            toast({ description: response?.details ?? 'Could not save default headers', duration: 3000 });
            return;
          }

          toast({ description: 'Default headers saved', duration: 3000 });
          setIsOpen(false);
          // Refresh in the background: the playground page observes this same query
          // to seed new tabs, and the dialog re-seeds from fresh data on next open.
          refetch();
        },
        onError: () => {
          toast({ description: 'Could not save default headers', duration: 3000 });
        },
      },
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setPersonalDraft(null);
          setGraphDraft(null);
        }
        setIsOpen(open);
      }}
    >
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="graphiql-toolbar-button">
              <LuSettings2 className="graphiql-toolbar-icon" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="rounded-md border bg-background px-2 py-1">Default Headers</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="select-none">Default Headers</DialogTitle>
          <DialogDescription className="select-none">
            These headers are added to every new tab you open in this playground. Tabs that are already open are not
            changed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12">
            <Loader />
          </div>
        ) : (
          <div className="flex flex-col gap-y-6">
            <div className="space-y-3">
              <h3 className="select-none text-sm font-medium">My defaults</h3>
              <p className="text-xs text-muted-foreground">
                Only you can see these. They override the graph defaults for headers with the same name.
              </p>
              <HeaderRows entries={personalEntries} onChange={setPersonalDraft} />
            </div>

            <div className="space-y-3">
              <h3 className="select-none text-sm font-medium">Graph defaults</h3>
              <p className="text-xs text-muted-foreground">
                {canEditGraphHeaders
                  ? 'Shared with everyone in this organization who can view this graph.'
                  : 'Shared with everyone in this organization. Only a graph admin can change these.'}
              </p>
              <HeaderRows entries={graphEntries} disabled={!canEditGraphHeaders} onChange={setGraphDraft} />
              <Alert>
                <InfoCircledIcon className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Graph defaults are visible to everyone in the organization, so do not put personal credentials here.
                  Add them under My defaults instead - a personal header replaces the graph one with the same name.
                </AlertDescription>
              </Alert>
            </div>

            <div className="space-y-2">
              <h3 className="select-none text-sm font-medium">Effective on new tabs</h3>
              <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">{preview}</pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending || isLoading || isError || hasInvalidKey}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
