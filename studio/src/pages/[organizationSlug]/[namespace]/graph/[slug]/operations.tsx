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
import { OperationsList } from "@/components/operations/operations-list";
import { FieldUsageSheet } from "@/components/analytics/field-usage";
import { OperationsSearch } from "@/components/operations/operations-search";
import { OperationContentModal } from "@/components/operations/operation-content-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Loader } from "@/components/ui/loader";
import { Pagination } from "@/components/ui/pagination";
import { Separator } from "@/components/ui/separator";
import { Spacer } from "@/components/ui/spacer";
import { Toolbar } from "@/components/ui/toolbar";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useOperationsFilters } from "@/hooks/use-operations-filters";
import { NextPageWithLayout } from "@/lib/page";
import { createConnectQueryKey, useQuery } from "@connectrpc/connect-query";
import {
  ExclamationTriangleIcon,
  ChartBarIcon,
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
  GetOperationsResponse,
  GetOperationsResponse_OperationType,
  OperationsFetchBasedOn,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { PlainMessage } from "@bufbuild/protobuf";
import { formatISO } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/router";
import { useContext, useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { createFilterState } from "@/components/analytics/constructAnalyticsTableQueryState";
import { useWorkspace } from "@/hooks/use-workspace";
import { useCurrentOrganization } from "@/hooks/use-current-organization";

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
    <Toolbar className="lg:px-0 xl:px-0">
      <Spacer />
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
  const {
    fetchBasedOn,
    fetchBasedOnStr,
    sortDirection,
    includeDeprecatedFields,
    applySorting,
    applyDeprecatedFieldsFilter,
  } = useOperationsFilters([]);

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
            requestCount = Number(op.metric.value) ?? 0;
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

  return (
    <div className="flex h-full w-full flex-col space-y-4 p-4">
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

      <OperationsList
        operations={computedOperations}
        selectedOperation={selectedOperation}
        onOperationSelect={onOperationSelect}
        searchQuery={localSearchQuery}
        sortField={fetchBasedOnStr}
        isLoading={isLoading}
        className="w-full flex-1"
      />

      {operations.length > 0 && (
        <div className="flex justify-start">
          <Pagination
            limit={pageSize}
            noOfPages={noOfPages}
            pageNumber={pageNumber}
          />
        </div>
      )}
    </div>
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

  const { filters, range, dateRange, refreshInterval } =
    useAnalyticsQueryState();

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

  // Filters from useAnalyticsQueryState already include operationHash if it's in filterState
  // No need to manually add it - it's already there from the URL
  const metricsFilters = filters;

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
    <div className="scrollbar-custom h-full space-y-4 overflow-y-auto pr-1">
      {selectedOperation ? (
        // Selected Operation State
        <>
          {/* Operation Header */}

          <div className="flex items-center justify-between px-1">
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
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link
                  href={{
                    pathname: `/[organizationSlug]/[namespace]/graph/[slug]/analytics/traces`,
                    query: {
                      organizationSlug,
                      namespace,
                      slug: router.query.slug,
                      filterState: createFilterState({
                        operationHash: selectedOperation.hash,
                        operationName: operationName || undefined,
                      }),
                      range: router.query.range,
                      dateRange: router.query.dateRange,
                    },
                  }}
                >
                  View Traces
                </Link>
              </Button>
              <Button onClick={() => setIsModalOpen(true)}>
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
    applySearchQuery,
  } = useOperationsFilters([]);

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
    return isNaN(size) || size < 1 ? 20 : size;
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

  // Use URL filters as single source of truth for selected operation
  const selectedOperation = useMemo(() => {
    const operationHashFilter = filters.find(
      (f: { field: string; value: string }) => f.field === "operationHash",
    );
    const operationNameFilter = filters.find(
      (f: { field: string; value: string }) => f.field === "operationName",
    );

    if (
      !operationHashFilter?.value ||
      operationNameFilter?.value === undefined ||
      operationNameFilter?.value === null
    ) {
      return undefined;
    }

    return {
      hash: operationHashFilter.value as string,
      name: operationNameFilter.value as string,
    };
  }, [filters]);

  // Read current filterState from URL
  const currentFilterState = useMemo(() => {
    try {
      return JSON.parse((router.query.filterState as string) || "[]");
    } catch {
      return [];
    }
  }, [router.query.filterState]);

  // Update URL filterState when operation is selected (merge with existing filters)
  const handleOperationSelect = (
    operationHash: string,
    operationName: string,
  ) => {
    // Normalize empty string to empty string (not null) for unnamed operations
    const normalizedOperationName = operationName || "";

    // Remove existing operationHash and operationName filters if any
    const filteredState = currentFilterState.filter(
      (f: { id: string }) =>
        f.id !== "operationHash" && f.id !== "operationName",
    );

    // Always add operationHash filter
    if (operationHash) {
      const hashFilters = JSON.parse(createFilterState({ operationHash }));
      filteredState.push(...hashFilters);
    }

    // Always add operationName filter (even if empty string for unnamed operations)
    // This ensures we can distinguish between operations with the same hash
    if (operationHash) {
      const nameFilters = JSON.parse(
        createFilterState({ operationName: normalizedOperationName }),
      );
      filteredState.push(...nameFilters);
    }

    // Update filterState in URL (this will automatically update selectedOperation via useMemo)
    applyParams({
      filterState: JSON.stringify(filteredState),
    });
  };

  // Clear operation selection when deprecated fields filter is enabled
  useEffect(() => {
    if (includeDeprecatedFields && selectedOperation?.hash) {
      // Read filterState directly from router to avoid circular dependency
      // This effect should only run when includeDeprecatedFields or selectedOperation changes,
      // not when filterState changes (since we're modifying it)
      let filterState: Array<{ id: string }>;
      try {
        filterState = JSON.parse((router.query.filterState as string) || "[]");
      } catch {
        filterState = [];
      }

      // Check if operation filters actually exist before trying to remove them
      // This prevents unnecessary applyParams calls when filterState changes
      // for other reasons (e.g., other filters) but operation filters are already removed
      const hasOperationFilters = filterState.some(
        (f: { id: string }) =>
          f.id === "operationHash" || f.id === "operationName",
      );

      // Only update if operation filters exist (prevents unnecessary updates)
      if (hasOperationFilters) {
        // Remove operationHash and operationName filters from filterState
        const filteredState = filterState.filter(
          (f: { id: string }) =>
            f.id !== "operationHash" && f.id !== "operationName",
        );

        applyParams({
          filterState: JSON.stringify(filteredState),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDeprecatedFields, selectedOperation?.hash, applyParams]);

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
    <div className="flex h-full w-full flex-col space-y-4 p-4 pr-1">
      {/* Two-Panel Layout */}
      <div className="flex min-h-0 flex-1 space-x-4 overflow-hidden">
        {/* Left Panel - Operations List */}
        <div className="flex w-1/3 min-w-0 flex-col">
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
        <div className="min-w-0 flex-1 overflow-hidden">
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
