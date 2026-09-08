import { GraphContext } from '@/components/layout/graph-layout';
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
import { Loader } from '@/components/ui/loader';
import { useToast } from '@/components/ui/use-toast';
import {
  DefaultHeaderEntry,
  defaultHeadersToJsonString,
  effectiveDefaultHeadersString,
  parseDefaultHeadersJson,
} from '@/lib/playground-headers';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { ChevronRightIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getPlaygroundDefaultHeaders,
  updatePlaygroundDefaultHeaders,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { useContext, useState } from 'react';
import { LuLayoutList } from 'react-icons/lu';
import { HeaderEditor } from './header-editor';

/** Renders the stored headers as the JSON document the editor holds. */
const fromServer = (headers?: { key: string; value: string }[]): string =>
  defaultHeadersToJsonString((headers ?? []).map((h) => ({ key: h.key, value: h.value })));

export const DefaultHeadersDialog = () => {
  const graphContext = useContext(GraphContext);
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);

  // Null means "not edited in this session", in which case the server's values are
  // shown. Any edit replaces the draft, and from then on nothing but the user can
  // change it - so a background refetch cannot clobber work in progress. Both are
  // reset to null on close, so the next open starts from fresh server data.
  const [personalDraft, setPersonalDraft] = useState<string | null>(null);
  const [graphDraft, setGraphDraft] = useState<string | null>(null);

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

  const personalText = personalDraft ?? fromServer(data?.personalHeaders);
  const graphText = graphDraft ?? fromServer(data?.graphHeaders);

  const personal = parseDefaultHeadersJson(personalText);
  const graph = parseDefaultHeadersJson(graphText);

  const canEditGraphHeaders = data?.canEditGraphHeaders ?? false;

  // Only gate Save on text the user can actually fix. The graph editor is read-only
  // for a non-admin and `save` omits that scope from the request entirely, so letting
  // it disable Save would strand the user with no way to save their own headers.
  const hasBlockingError = !personal.success || (canEditGraphHeaders && !graph.success);

  // Nothing sensible to preview while either side is unparseable.
  const preview = hasBlockingError
    ? null
    : effectiveDefaultHeadersString(graph.success ? graph.entries : [], personal.success ? personal.entries : []);

  const closeDialog = () => {
    setPersonalDraft(null);
    setGraphDraft(null);
    setIsOpen(false);
  };

  const save = () => {
    if (!personal.success || (canEditGraphHeaders && !graph.success)) {
      return;
    }

    const toHeaders = (entries: DefaultHeaderEntry[]) => ({ headers: entries });

    mutate(
      {
        federatedGraphName,
        namespace,
        personalHeaders: toHeaders(personal.entries),
        ...(canEditGraphHeaders && graph.success ? { graphHeaders: toHeaders(graph.entries) } : {}),
      },
      {
        onSuccess: ({ response }) => {
          if (response?.code !== EnumStatusCode.OK) {
            toast({ description: response?.details ?? 'Could not save default headers', duration: 3000 });
            return;
          }

          toast({ description: 'Default headers saved', duration: 3000 });
          closeDialog();
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
        if (open) {
          setIsOpen(true);
          return;
        }
        closeDialog();
      }}
    >
      {/* The divider spans the full width, but the hover fill is inset and rounded so it
          never collides with the editors pane's own rounded corners. */}
      <div className="border-t p-1">
        <DialogTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-x-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LuLayoutList className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">Set up your default headers</span>
            <ChevronRightIcon className="h-4 w-4 flex-shrink-0" />
          </button>
        </DialogTrigger>
      </div>
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
          <div className="flex flex-col gap-y-5">
            <section className="space-y-2">
              <div className="space-y-1">
                <div className="flex select-none items-baseline gap-x-2">
                  <h3 className="text-sm font-medium">Graph defaults</h3>
                  {!canEditGraphHeaders && <span className="text-xs text-muted-foreground">read only</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {canEditGraphHeaders
                    ? 'Shared with everyone in this organization who can view this graph.'
                    : 'Shared with everyone in this organization. Only a graph admin can change these.'}
                </p>
              </div>
              <HeaderEditor
                value={graphText}
                error={graph.success ? null : graph.error}
                readOnly={!canEditGraphHeaders}
                onChange={setGraphDraft}
              />
              <p className="flex items-start gap-x-1.5 text-xs text-muted-foreground">
                <InfoCircledIcon className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>Everyone in the organization can read these, so keep personal credentials out of them.</span>
              </p>
            </section>

            <section className="space-y-2">
              <div className="space-y-1">
                <h3 className="select-none text-sm font-medium">My defaults</h3>
                <p className="text-xs text-muted-foreground">
                  Only you can see these. They override the graph defaults for headers with the same name.
                </p>
              </div>
              <HeaderEditor
                value={personalText}
                error={personal.success ? null : personal.error}
                onChange={setPersonalDraft}
              />
            </section>

            <section className="space-y-2">
              <div className="flex select-none items-baseline gap-x-2">
                <h3 className="text-sm font-medium">Effective on new tabs</h3>
                <span className="text-xs text-muted-foreground">read only</span>
              </div>
              {/* Deliberately unlike the editors above: filled, borderless and without
                  line numbers, so it does not read as another thing to type into. */}
              <pre className="max-h-48 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5">
                {preview ?? 'Fix the errors above to see the result.'}
              </pre>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={closeDialog}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending || isLoading || isError || hasBlockingError}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
