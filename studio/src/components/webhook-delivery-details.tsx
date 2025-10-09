import { useToast } from "@/components/ui/use-toast";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import {
  getWebhookDeliveryDetails,
  redeliverWebhook
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { Loader } from "@/components/ui/loader";
import { EmptyState } from "@/components/empty-state";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format-date";
import { msToTime } from "@/lib/insights-helpers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeViewer } from "@/components/code-viewer";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface WebhookDeliveryDetailsProps {
  deliveryId: string | undefined;
  allowRedelivery: boolean;
  onOpenChange(open: boolean): void;
  refreshDeliveries(): void;
}

export function WebhookDeliveryDetails({ deliveryId, allowRedelivery, onOpenChange, refreshDeliveries }: WebhookDeliveryDetailsProps) {
  const { toast } = useToast();
  const { data, error, isLoading, refetch } = useQuery(
    getWebhookDeliveryDetails,
    { id: deliveryId },
    { enabled: !!deliveryId },
  );

  const { mutate, isPending } = useMutation(redeliverWebhook, {
    onSuccess: (data) => {
      if (data.response?.code === EnumStatusCode.OK) {
        toast({
          description: "Webhook redelivery attempted",
          duration: 2000,
        });
        refreshDeliveries();
      } else {
        toast({
          description: data.response?.details,
          duration: 2000,
        });
      }
    },
    onError: () => {
      toast({
        description: `Could not attempt redelivery`,
        duration: 2000,
      });
    },
  });

  let content;
  if (isLoading) {
    content = <Loader fullscreen />;
  } else if (
    error ||
    data?.response?.code !== EnumStatusCode.OK ||
    !data.delivery
  ) {
    content = (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve delivery details"
        description={
          data?.response?.details || error?.message || "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  } else {
    const details = data.delivery;
    content = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-x-2 rounded-md border border-input p-2">
            <Badge>POST</Badge>
            <code className="w-full truncate break-all text-xs">
              {details.endpoint}
            </code>
          </div>
          {allowRedelivery && (<Button
            variant="secondary"
            className="w-full md:w-auto"
            isLoading={isPending}
            onClick={() => {
              mutate({
                id: details.id,
              });
            }}
          >
            Redeliver
          </Button>)}
        </div>
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Retries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  {formatDateTime(new Date(details.createdAt))}
                </TableCell>
                <TableCell>
                  {details.responseStatusCode || details.responseErrorCode}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{details.eventName}</Badge>
                </TableCell>
                <TableCell>{msToTime(details.duration)}</TableCell>
                <TableCell>{details.retryCount}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableWrapper>
        <div className="text-sm text-muted-foreground">
          Triggered by {details.createdBy ?? "unknown user"}
        </div>
        <Tabs className="mt-2" defaultValue="request">
          <TabsList>
            <TabsTrigger value="request">Request</TabsTrigger>
            <TabsTrigger value="response" className="gap-x-2">
              Response
            </TabsTrigger>
          </TabsList>
          <TabsContent autoFocus={false} value="request" className="px-1">
            <h3 className="mb-2 mt-6 text-base font-semibold tracking-tight">
              Headers
            </h3>
            <div className="scrollbar-custom overflow-auto rounded border">
              <CodeViewer
                disableLinking
                code={details.requestHeaders}
                language="json"
              />
            </div>
            <h3 className="mb-2 mt-6 text-base font-semibold tracking-tight">
              Payload
            </h3>
            <div className="scrollbar-custom overflow-auto rounded border">
              <CodeViewer
                disableLinking
                code={details.payload}
                language="json"
              />
            </div>
          </TabsContent>
          <TabsContent autoFocus={false} value="response" className="px-1">
            {details.errorMessage && (
              <>
                <h3 className="mb-2 mt-6 text-base font-semibold tracking-tight">
                  Error
                </h3>
                <div className="rounded border px-3 py-2 font-mono text-xs">
                  {details.errorMessage}
                </div>
              </>
            )}
            <h3 className="mb-2 mt-6 text-base font-semibold tracking-tight">
              Headers
            </h3>
            <div className="scrollbar-custom overflow-auto rounded border">
              <CodeViewer
                disableLinking
                code={details.responseHeaders || ""}
                language="json"
              />
            </div>
            {JSON.parse(details.responseBody || "{}") && (
              <>
                <h3 className="mb-2 mt-6 text-base font-semibold tracking-tight">
                  Body
                </h3>
                <div className="scrollbar-custom overflow-auto rounded border">
                  <CodeViewer
                    disableLinking
                    code={details.responseBody || "{}"}
                    language="json"
                  />
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <Sheet modal open={!!deliveryId} onOpenChange={onOpenChange}>
      <SheetContent className="scrollbar-custom w-full max-w-full overflow-y-scroll sm:max-w-full md:max-w-2xl lg:max-w-3xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            Details{" "}
            {data?.delivery?.isRedelivery && (
              <Badge variant="muted">redelivery</Badge>
            )}
          </SheetTitle>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}
