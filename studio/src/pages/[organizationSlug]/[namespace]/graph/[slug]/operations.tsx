import { FieldUsageSheet } from "@/components/analytics/field-usage";
import {
  ErrorMetricsCard,
  LatencyMetricsCard,
  RequestMetricsCard,
} from "@/components/analytics/metrics";
import { RefreshInterval } from "@/components/analytics/refresh-interval";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import {
  DatePickerWithRange,
  DateRangePickerChangeHandler,
} from "@/components/date-picker-with-range";
import { EmptyState } from "@/components/empty-state";
import {
  GraphContext,
  GraphPageLayout,
  getGraphLayout,
} from "@/components/layout/graph-layout";
import { ClientUsageTable } from "@/components/operations/client-usage-table";
import { DeprecatedFieldsTable } from "@/components/operations/deprecated-fields-table";
import { OperationContentModal } from "@/components/operations/operation-content-modal";
import { OperationsList } from "@/components/operations/operations-list";
import { OperationsSearch } from "@/components/operations/operations-search";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Loader } from "@/components/ui/loader";
import { Pagination } from "@/components/ui/pagination";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spacer } from "@/components/ui/spacer";
import { Toolbar } from "@/components/ui/toolbar";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useOperationsFilters } from "@/hooks/use-operations-filters";
import { useWorkspace } from "@/hooks/use-workspace";
import { NextPageWithLayout } from "@/lib/page";
import { PlainMessage } from "@bufbuild/protobuf";
import { createConnectQueryKey, useQuery } from "@connectrpc/connect-query";
import {
  ChartBarIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { UpdateIcon } from "@radix-ui/react-icons";
import {
  keepPreviousData,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  getGraphMetrics,
  getOperations,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  AnalyticsFilter,
  AnalyticsViewFilterOperator,
  GetOperationsResponse,
  GetOperationsResponse_OperationType,
  OperationsFetchBasedOn,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";

const OperationsToolbar = () => {
  const graphContext = useContext(GraphContext);
  const client = useQueryClient();

  const { range, dateRange, refreshInterval } = useAnalyticsQueryState();

  const isFetching = useIsFetching();

  const applyParams = useApplyParams();

  const onDateRangeChange: DateRangePickerChangeHandler = ({
    range,
    dateRange,
  }) => {
    if (range) {
      applyParams({
        range: range.toString(),
        dateRange: null,
      });
    } else if (dateRange) {
      const stringifiedDateRange = JSON.stringify({
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end ?? dateRange.start),
      });

      applyParams({
        range: null,
        dateRange: stringifiedDateRange,
      });
    }
  };

  const onRefreshIntervalChange = (value?: number) => {
    applyParams({
      refreshInterval: value ? value.toString() : null,
    });
  };

  const analyticsRetention = useFeatureLimit("analytics-retention", 7);

  return (
    <Toolbar className="flex-nowrap lg:px-0 xl:px-0">
      <Spacer className="hidden md:flex" />
      <div className="flex flex-1 items-center gap-2 md:flex-initial">
        <DatePickerWithRange
          range={range}
          dateRange={dateRange}
          onChange={onDateRangeChange}
          calendarDaysLimit={analyticsRetention}
        />
        <Button
          isLoading={!!isFetching}
          onClick={() => {
            client.invalidateQueries({
              queryKey: createConnectQueryKey(getGraphMetrics, {
                namespace: graphContext?.graph?.namespace,
                federatedGraphName: graphContext?.graph?.name,
                range,
                dateRange: range
                  ? undefined
                  : {
                      start: formatISO(dateRange.start),
                      end: formatISO(dateRange.end),
                    },
              }),
            });
          }}
          variant="outline"
          size="icon"
        >
          <UpdateIcon />
        </Button>
        <RefreshInterval
          value={refreshInterval}
          onChange={onRefreshIntervalChange}
        />
      </div>
    </Toolbar>
  );
};

const OperationsLeftPanel = ({
  selectedOperation,
  onOperationSelect,
  operations,
  isLoading,
  localSearchQuery,
  onSearchQueryChange,
  pageNumber,
  pageSize,
  noOfPages,
}: {
  selectedOperation:
    | {
        hash: string;
        name: string;
      }
    | undefined;
  onOperationSelect: (operationHash: string, operationName: string) => void;
  operations: PlainMessage<GetOperationsResponse>["operations"];
  isLoading: boolean;
  localSearchQuery: string;
  onSearchQueryChange: (query: string) => void;
  pageNumber: number;
  pageSize: number;
  noOfPages: number;
}) => {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const {
    fetchBasedOn,
    fetchBasedOnStr,
    sortDirection,
    includeDeprecatedFields,
    applySorting,
    applyDeprecatedFieldsFilter,
  } = useOperationsFilters();

  const computedOperations = useMemo(() => {
    // Backend handles sorting, so we just map the data
    return operations.map((op) => {
      // Handle oneof metric field
      let latency: number | undefined;
      let requestCount: number | undefined;
      let errorRate: number | undefined;

      if (op.metric) {
        switch (op.metric.case) {
          case "latency":
            latency = op.metric.value;
            break;
          case "requestCount":
            requestCount = op.metric.value ? Number(op.metric.value) : 0;
            break;
          case "errorPercentage":
            errorRate = op.metric.value;
            break;
        }
      }

      return {
        hash: op.hash,
        name: op.name,
        type:
          op.type === GetOperationsResponse_OperationType.QUERY
            ? ("query" as const)
            : op.type === GetOperationsResponse_OperationType.MUTATION
              ? ("mutation" as const)
              : ("subscription" as const),
        latency: latency ?? 0,
        requestCount: requestCount ?? 0,
        errorRate: errorRate ?? 0,
        hasDeprecatedFields: op.hasDeprecatedFields || false,
      };
    });
  }, [operations]);

  // Handle operation selection - close sheet on mobile when operation is selected
  const handleOperationSelect = (
    operationHash: string,
    operationName: string,
  ) => {
    onOperationSelect(operationHash, operationName);
    setIsSheetOpen(false);
  };

  // Full left panel content (used in both desktop and mobile sheet)
  const leftPanelContent = (
    <div className="flex h-full w-full flex-col space-y-4 px-1 md:px-4 md:py-4">
      <OperationsSearch
        searchQuery={localSearchQuery}
        onSearchQueryChange={onSearchQueryChange}
        fetchBasedOn={fetchBasedOn}
        onFetchBasedOnChange={(fetchBasedOn) =>
          applySorting(fetchBasedOn, sortDirection)
        }
        sortDirection={sortDirection}
        onSortDirectionChange={(direction) =>
          applySorting(fetchBasedOn, direction)
        }
        includeDeprecatedFields={includeDeprecatedFields}
        onIncludeDeprecatedFieldsChange={applyDeprecatedFieldsFilter}
        className="w-full"
      />

      <div className="flex min-h-0 flex-1 md:block">
        <OperationsList
          operations={computedOperations}
          selectedOperation={selectedOperation}
          onOperationSelect={handleOperationSelect}
          searchQuery={localSearchQuery}
          sortField={fetchBasedOnStr}
          isLoading={isLoading}
          className="h-full w-full"
        />
      </div>

      {operations.length > 0 && (
        <div className="flex justify-center md:flex">
          <Pagination
            limit={pageSize}
            noOfPages={noOfPages}
            pageNumber={pageNumber}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: Search button that opens sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start text-left font-normal md:hidden"
          >
            <MagnifyingGlassIcon className="mr-2 h-4 w-4" />
            {localSearchQuery || "Search operations..."}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-[85vh]">
          <SheetHeader>
            <SheetTitle>Search Operations</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex h-[calc(85vh-80px)] flex-col overflow-hidden">
            {leftPanelContent}
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop: Full left panel */}
      <div className="hidden h-full w-full md:block">{leftPanelContent}</div>
    </>
  );
};

const OperationsRightPanel = ({
  selectedOperation,
  operations,
}: {
  selectedOperation:
    | {
        hash: string;
        name: string;
      }
    | undefined;
  operations: PlainMessage<GetOperationsResponse>["operations"];
}) => {
  const router = useRouter();
  const graphContext = useContext(GraphContext);
  const syncId = `${graphContext?.graph?.namespace}-${graphContext?.graph?.name}`;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const {
    namespace: { name: namespace },
  } = useWorkspace();
  const organizationSlug = useCurrentOrganization()?.slug;

  const { range, dateRange, refreshInterval } = useAnalyticsQueryState();

  const selectedOperationData = selectedOperation
    ? operations.find((op) => {
        // Match by hash and name if name is provided
        const matchesHash = op.hash === selectedOperation.hash;
        if (!matchesHash) return false;

        // If no name filter is set, match any operation with that hash
        if (
          selectedOperation.name === null ||
          selectedOperation.name === undefined
        ) {
          return true;
        }

        // Otherwise, match exact name (including empty string for unnamed operations)
        const opName = op.name || "";
        return selectedOperation.name === opName;
      })
    : undefined;
  const operationName = selectedOperationData?.name || "";

  // Add operationHash and operationName filters from URL params if operation is selected
  const metricsFilters: AnalyticsFilter[] = useMemo(() => {
    const operationFilters = [];
    if (selectedOperation) {
      operationFilters.push(
        new AnalyticsFilter({
          field: "operationHash",
          value: selectedOperation.hash,
          operator: AnalyticsViewFilterOperator.EQUALS,
        }),
      );
      // Only add operationName filter if operation has a name (not unnamed)
      if (selectedOperation.name) {
        operationFilters.push(
          new AnalyticsFilter({
            field: "operationName",
            value: selectedOperation.name,
            operator: AnalyticsViewFilterOperator.EQUALS,
          }),
        );
      }
    }
    // Include any existing filters from filterState (though typically empty on this page)
    return operationFilters;
  }, [selectedOperation]);

  let { data, isLoading, error, refetch } = useQuery(
    getGraphMetrics,
    {
      namespace: graphContext?.graph?.namespace,
      federatedGraphName: graphContext?.graph?.name,
      range,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
      filters: metricsFilters,
    },
    {
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      refetchInterval: refreshInterval,
    },
  );

  if (!isLoading && (error || data?.response?.code !== EnumStatusCode.OK)) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve operations data"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  } else if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader fullscreen />
      </div>
    );
  }

  // Show empty state if there are no operations
  if (!operations || operations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<ChartBarIcon />}
          title="No operations found"
          description="There are no operations available for the selected filters."
        />
      </div>
    );
  }

  return (
    <div className="scrollbar-custom h-full space-y-4 overflow-y-auto px-1 md:px-0 md:pr-1">
      {selectedOperation ? (
        // Selected Operation State
        <>
          {/* Operation Header */}

          <div className="flex flex-col gap-4 px-1 md:flex-row md:items-center md:justify-between md:gap-0">
            <div>
              <h3 className="text-lg font-semibold">
                {operationName || "Unnamed Operation"}
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  {selectedOperation.hash}
                </p>
                <CopyButton
                  value={selectedOperation.hash}
                  tooltip="Copy operation hash"
                  variant="ghost"
                  size="icon-sm"
                  className="h-[14px] w-[14px] text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex w-full items-center gap-2 md:w-auto">
              <Button
                variant="outline"
                asChild
                className="flex-1 md:flex-initial"
              >
                <Link
                  href={{
                    pathname: `/[organizationSlug]/[namespace]/graph/[slug]/analytics/traces`,
                    query: {
                      organizationSlug,
                      namespace,
                      slug: router.query.slug,
                      operationHash: selectedOperation.hash,
                      operationName: operationName || undefined,
                      range: router.query.range,
                      dateRange: router.query.dateRange,
                    },
                  }}
                >
                  View Traces
                </Link>
              </Button>
              <Button
                onClick={() => setIsModalOpen(true)}
                className="flex-1 md:flex-initial"
              >
                View Operation
              </Button>
            </div>
          </div>

          <Separator className="my-4" />

          {/* Client Usage Table - Always at the top */}
          <ClientUsageTable
            operationHash={selectedOperation.hash}
            operationName={operationName}
          />

          <Separator className="my-4" />

          {/* Deprecated Fields Table - Below Client Usage */}
          <DeprecatedFieldsTable
            operationHash={selectedOperation.hash}
            operationName={operationName}
          />

          <Separator className="my-4" />

          {/* Operation-specific Charts */}
          <div className="flex flex-col gap-4">
            <RequestMetricsCard
              data={data?.requests}
              syncId={syncId}
              showTopList={false}
              chartClassName="h-36"
            />
            <LatencyMetricsCard
              data={data?.latency}
              syncId={syncId}
              showTopList={false}
              chartClassName="h-36"
            />
            <ErrorMetricsCard
              data={data?.errors}
              syncId={syncId}
              showTopList={false}
              chartClassName="h-36"
            />
          </div>
        </>
      ) : (
        // Default State - All Operations Charts
        <div className="flex flex-col gap-4">
          <RequestMetricsCard
            data={data?.requests}
            syncId={syncId}
            showTopList={false}
            chartClassName="h-36"
          />
          <LatencyMetricsCard
            data={data?.latency}
            syncId={syncId}
            showTopList={false}
            chartClassName="h-36"
          />
          <ErrorMetricsCard
            data={data?.errors}
            syncId={syncId}
            showTopList={false}
            chartClassName="h-36"
          />
        </div>
      )}
      {selectedOperation && (
        <OperationContentModal
          operationHash={selectedOperation.hash}
          operationName={operationName || undefined}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
};

const OperationsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const applyParams = useApplyParams();
  const graphContext = useContext(GraphContext);
  const { filters, range, dateRange } = useAnalyticsQueryState();
  const {
    searchQuery: urlSearchQuery,
    fetchBasedOn,
    sortDirection,
    includeDeprecatedFields,
    clientNames,
    applySearchQuery,
  } = useOperationsFilters();

  // Use URL as single source of truth, debounce for input responsiveness
  const [localSearchQuery, setLocalSearchQuery] = useState(urlSearchQuery);
  const [debouncedSearchQuery] = useDebounce(localSearchQuery, 500);

  // Sync localSearchQuery with URL when URL changes externally (e.g., browser back/forward)
  useEffect(() => {
    setLocalSearchQuery(urlSearchQuery);
  }, [urlSearchQuery]);

  // Pagination state from URL
  const pageNumber = useMemo(() => {
    const page = parseInt(router.query.page as string, 10);
    return isNaN(page) || page < 1 ? 1 : page;
  }, [router.query.page]);

  // Update URL when debounced search query changes (only if different)
  // Reset to page 1 when search changes
  useEffect(() => {
    if (debouncedSearchQuery !== urlSearchQuery) {
      applySearchQuery(debouncedSearchQuery);
      // Reset to page 1 when search changes
      if (pageNumber !== 1) {
        applyParams({ page: "1" });
      }
    }
  }, [
    debouncedSearchQuery,
    urlSearchQuery,
    applySearchQuery,
    pageNumber,
    applyParams,
  ]);

  const pageSize = useMemo(() => {
    const size = parseInt(router.query.pageSize as string, 10);
    return isNaN(size) || size < 1 ? 10 : size;
  }, [router.query.pageSize]);

  const offset = useMemo(() => {
    return (pageNumber - 1) * pageSize;
  }, [pageNumber, pageSize]);

  const {
    data: operationsData,
    isLoading: isLoadingOperations,
    isFetching: isFetchingOperations,
    error,
    refetch,
  } = useQuery(
    getOperations,
    {
      namespace: graphContext?.graph?.namespace,
      federatedGraphName: graphContext?.graph?.name,
      range,
      dateRange: range
        ? undefined
        : {
            start: formatISO(dateRange.start),
            end: formatISO(dateRange.end),
          },
      searchQuery: debouncedSearchQuery || undefined,
      fetchBasedOn: fetchBasedOn || OperationsFetchBasedOn.REQUESTS,
      sortDirection: sortDirection || "desc",
      includeContent: true,
      limit: pageSize,
      offset: offset,
      includeDeprecatedFields: includeDeprecatedFields || undefined,
      includeOperationsWithDeprecatedFieldsOnly: includeDeprecatedFields
        ? true
        : undefined,
      clientNames,
    },
    {
      enabled: !!graphContext?.graph?.name,
      // Keep previous data visible while refetching to prevent page unmount
      placeholderData: keepPreviousData,
      // Ensure query refetches when filters change
      refetchOnMount: true,
      // Prevent stale data accumulation
      staleTime: 0,
      gcTime: 0,
    },
  );

  // Calculate number of pages
  // If we get fewer results than pageSize, we're on the last page
  // Otherwise, assume there might be more pages (optimistic approach)
  const noOfPages = useMemo(() => {
    if (!operationsData?.operations) {
      return 0;
    }
    const operationsCount = operationsData.operations.length;
    if (operationsCount < pageSize) {
      // We're on the last page
      return pageNumber;
    }
    // We got a full page, assume there might be more
    // Add 1 to current page to indicate there might be more pages
    return pageNumber + 1;
  }, [operationsData?.operations, pageSize, pageNumber]);

  // Use URL params as single source of truth for selected operation
  const selectedOperation = useMemo(() => {
    const operationHash = router.query.operationHash as string | undefined;
    const operationName = router.query.operationName as string | undefined;

    // If operationHash exists but operationName doesn't, it's an unnamed operation (fallback to '')
    if (!operationHash) {
      return undefined;
    }

    return {
      hash: operationHash,
      name: operationName ?? "",
    };
  }, [router.query.operationHash, router.query.operationName]);

  // Update URL params when operation is selected
  const handleOperationSelect = (
    operationHash: string,
    operationName: string,
  ) => {
    // For unnamed operations, only set operationHash (don't include operationName in URL)
    const normalizedOperationName = operationName || "";
    const params: Record<string, string | null> = {
      operationHash: operationHash || null,
    };

    // Only include operationName if it's not empty (named operations)
    if (normalizedOperationName) {
      params.operationName = normalizedOperationName;
    } else {
      // Remove operationName from URL for unnamed operations
      params.operationName = null;
    }

    applyParams(params);
  };

  // Check and clear operation selection when operations data changes (after filters change or refetch)
  useEffect(() => {
    if (!selectedOperation || !operationsData?.operations) {
      return;
    }

    // Check if the selected operation exists in the current filtered operations list
    const operationExists = operationsData.operations.some((op) => {
      const matchesHash = op.hash === selectedOperation.hash;
      if (!matchesHash) return false;

      // Match by name (including empty string for unnamed operations)
      const opName = op.name || "";
      const selectedName = selectedOperation.name || "";
      return opName === selectedName;
    });

    // If operation doesn't exist in the filtered list, clear it from URL params
    if (!operationExists) {
      applyParams({
        operationHash: null,
        operationName: null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationsData?.operations]);

  // Only show fullscreen loader on initial load, not during refetches
  if (isLoadingOperations && !operationsData) {
    return <Loader fullscreen />;
  }

  if (error || operationsData?.response?.code !== EnumStatusCode.OK) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not retrieve operations data"
        description={
          operationsData?.response?.details ||
          error?.message ||
          "Please try again"
        }
        actions={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col space-y-4 p-2 pr-1 md:p-4 md:pr-1">
      {/* Two-Panel Layout */}
      <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden md:flex-row md:space-x-4 md:space-y-0">
        {/* Left Panel - Operations List */}
        <div className="flex w-full min-w-0 flex-col md:w-1/3">
          <Card className="flex h-full flex-col overflow-hidden">
            <OperationsLeftPanel
              selectedOperation={selectedOperation}
              onOperationSelect={handleOperationSelect}
              operations={operationsData.operations}
              isLoading={isFetchingOperations}
              localSearchQuery={localSearchQuery}
              onSearchQueryChange={setLocalSearchQuery}
              pageNumber={pageNumber}
              pageSize={pageSize}
              noOfPages={noOfPages}
            />
          </Card>
        </div>

        {/* Right Panel - Charts */}
        <div className="min-w-0 flex-1 overflow-hidden md:w-auto">
          <div className="h-full overflow-y-auto">
            <OperationsRightPanel
              selectedOperation={selectedOperation}
              operations={operationsData.operations}
            />
          </div>
        </div>
      </div>
      <FieldUsageSheet />
    </div>
  );
};

OperationsPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Operations"
      subtitle="Comprehensive view into GraphQL Operations Performance"
      items={<OperationsToolbar />}
      noPadding
      className="md:w-full lg:pl-6 lg:pr-5 xl:pl-8 xl:pr-5"
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Operations",
    },
  );

export default OperationsPage;
