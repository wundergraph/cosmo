import { RefreshInterval } from "@/components/analytics/refresh-interval";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import {
  useAnalyticsQueryState,
  useDateRangeQueryState,
} from "@/components/analytics/useAnalyticsQueryState";
import { CodeViewer } from "@/components/code-viewer";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import { getDashboardLayout } from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spacer } from "@/components/ui/spacer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { formatDateTime } from "@/lib/format-date";
import { createDateRange, msToTime } from "@/lib/insights-helpers";
import { NextPageWithLayout } from "@/lib/page";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@connectrpc/connect-query";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CheckIcon, UpdateIcon } from "@radix-ui/react-icons";
import { keepPreviousData } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getWebhookDeliveryDetails,
  getOrganizationWebhookHistory,
  redeliverWebhook,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { GetOrganizationWebhookHistoryResponse } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatISO } from "date-fns";
import { useRouter } from "next/router";

const WebhookDeliveryDetails = ({ refresh }: { refresh: () => void }) => {
  const router = useRouter();
  const { toast } = useToast();

  const detailsId = router.query.details as string;

  const { data, error, isLoading, refetch } = useQuery(
    getWebhookDeliveryDetails,
    {
      id: detailsId,
    },
    {
      enabled: !!detailsId,
    },
  );

  const { mutate, isPending } = useMutation(redeliverWebhook, {
    onSuccess: (data) => {
      if (data.response?.code === EnumStatusCode.OK) {
        toast({
          description: "Webhook redelivery attempted",
          duration: 2000,
        });
        refresh();
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
          <Button
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
          </Button>
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
    <Sheet
      modal
      open={!!detailsId}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          const newQuery = { ...router.query };
          delete newQuery["details"];
          router.replace({
            query: newQuery,
          });
        }
      }}
    >
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
};

const WebhookHistoryPage: NextPageWithLayout = () => {
  const router = useRouter();
  const pageNumber = router.query.page
    ? parseInt(router.query.page as string)
    : 1;
  const limit = Number.parseInt((router.query.pageSize as string) || "10");
  const {
    dateRange: { start, end },
    range,
  } = useDateRangeQueryState();
  const { refreshInterval } = useAnalyticsQueryState();
  const type = (router.query.type as string) || "";

  const { data, isLoading, error, isFetching, refetch } = useQuery(
    getOrganizationWebhookHistory,
    {
      pagination: {
        limit: limit > 50 ? 50 : limit,
        offset: (pageNumber - 1) * limit,
      },
      dateRange: {
        start: formatISO(range ? createDateRange(range).start : start),
        end: formatISO(range ? createDateRange(range).end : end),
      },
      filterByType: type,
    },
    {
      placeholderData: keepPreviousData,
      refetchInterval: refreshInterval,
    },
  );

  const applyParams = useApplyParams();

  const onDateRangeChange: DateRangePickerChangeHandler = ({
    dateRange,
    range,
  }) => {
    if (range) {
      applyParams({
        range: range.toString(),
        dateRange: null,
        page: "1",
      });
    } else if (dateRange) {
      const stringifiedDateRange = JSON.stringify({
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end ?? dateRange.start),
      });

      applyParams({
        range: null,
        dateRange: stringifiedDateRange,
        page: "1",
      });
    }
  };

  const historyRetention = useFeatureLimit("analytics-retention", 7);

  const noOfPages = Math.ceil((data?.totalCount || 0) / limit);

  const columnHelper =
    createColumnHelper<
      GetOrganizationWebhookHistoryResponse["deliveries"][number]
    >();

  const columns = [
    columnHelper.display({
      id: "status",
      size: 40,
      header: () => <div className="w-4"></div>,
      cell: (ctx) => {
        const statusCode = ctx.row.original.responseStatusCode;
        const isSuccess = !!statusCode && statusCode >= 200 && statusCode < 300;

        return (
          <div className="flex justify-center">
            {isSuccess ? (
              <CheckIcon className="h-4 w-4 text-success" />
            ) : (
              <ExclamationTriangleIcon className="h-4 w-4 text-destructive" />
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor("createdAt", {
      header: () => <div>Time</div>,
      cell: (ctx) => formatDateTime(new Date(ctx.getValue())),
    }),
    columnHelper.accessor("type", {
      header: () => <div>Type</div>,
      cell: (ctx) => <div>{ctx.getValue()}</div>,
    }),
    columnHelper.accessor("eventName", {
      header: () => <div>Event</div>,
      cell: (ctx) => <Badge variant="secondary">{ctx.getValue()}</Badge>,
    }),
    columnHelper.accessor("responseStatusCode", {
      header: () => <div>Status</div>,
      cell: (ctx) => {
        const statusCode = ctx.row.original.responseStatusCode;
        const isSuccess = !!statusCode && statusCode >= 200 && statusCode < 300;

        return (
          <div
            className={cn(
              "flex items-center gap-x-2",
              !isSuccess && "text-destructive",
            )}
          >
            <span>
              {ctx.row.original.responseStatusCode ||
                ctx.row.original.responseErrorCode}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("duration", {
      header: () => <div>Duration</div>,
      cell: (ctx) => {
        return <span>{msToTime(ctx.getValue())}</span>;
      },
    }),
    columnHelper.accessor("retryCount", {
      header: () => <div>Retries</div>,
    }),
  ];

  const table = useReactTable({
    data: data?.deliveries ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true,
  });

  const onRefreshIntervalChange = (value?: number) => {
    applyParams({
      refreshInterval: value ? value.toString() : null,
    });
  };

  return (
    <div className="flex h-full flex-col gap-y-4">
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <DatePickerWithRange
          range={range}
          dateRange={{ start, end }}
          onChange={onDateRangeChange}
          calendarDaysLimit={historyRetention}
        />
        <Select
          value={type}
          onValueChange={(val) =>
            applyParams({
              type: val || null,
            })
          }
        >
          <SelectTrigger className="w-max">
            <SelectValue></SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Types</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
            <SelectItem value="slack">Slack</SelectItem>
            <SelectItem value="admission">Admission</SelectItem>
          </SelectContent>
        </Select>
        <Spacer />
        <Button
          isLoading={isLoading || isFetching}
          size="icon"
          variant="outline"
          onClick={() => refetch()}
        >
          <UpdateIcon />
        </Button>
        <RefreshInterval
          value={refreshInterval}
          onChange={onRefreshIntervalChange}
        />
      </div>
      <TableWrapper className="max-h-full">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      style={{
                        width: `${header.getSize()}px`,
                      }}
                      key={header.id}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => {
                  applyParams({
                    details: row.original.id,
                  });
                }}
                className="group cursor-pointer hover:bg-secondary/30"
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {isLoading && <Loader className="my-12" />}
        {!isLoading &&
          (error || data?.response?.code !== EnumStatusCode.OK) && (
            <EmptyState
              icon={<ExclamationTriangleIcon />}
              title="Could not retrieve history"
              description={
                data?.response?.details || error?.message || "Please try again"
              }
              actions={<Button onClick={() => refetch()}>Retry</Button>}
            />
          )}
        {data?.deliveries.length === 0 && (
          <p className="w-full p-8 text-center text-sm italic text-muted-foreground">
            No history found
          </p>
        )}
      </TableWrapper>
      <Pagination limit={limit} noOfPages={noOfPages} pageNumber={pageNumber} />
      <WebhookDeliveryDetails refresh={refetch} />
    </div>
  );
};

WebhookHistoryPage.getLayout = (page) => {
  return getDashboardLayout(
    page,
    "Webhook History",
    "Track all webhooks that are fired in your organization",
  );
};

export default WebhookHistoryPage;
