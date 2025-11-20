import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  BarsArrowDownIcon,
  BarsArrowUpIcon,
} from "@heroicons/react/24/outline";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useCallback, useContext, useMemo } from "react";
import { AnalyticsFilters } from "@/components/analytics/filters";
import {
  OperationsFetchBasedOn,
  CustomOptions,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import type { AnalyticsFilter } from "@/components/analytics/filters";
import { GraphContext } from "@/components/layout/graph-layout";
import { useQuery } from "@connectrpc/connect-query";
import { getClientsFromAnalytics } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { useOperationsFilters } from "@/hooks/use-operations-filters";
import { useApplyParams } from "@/components/analytics/use-apply-params";
import { useRouter } from "next/router";

interface OperationsSearchProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  fetchBasedOn: OperationsFetchBasedOn;
  onFetchBasedOnChange: (fetchBasedOn: OperationsFetchBasedOn) => void;
  sortDirection: string;
  onSortDirectionChange: (direction: string) => void;
  includeDeprecatedFields: boolean;
  onIncludeDeprecatedFieldsChange: (include: boolean) => void;
  className?: string;
}

const SORT_OPTIONS = [
  { value: OperationsFetchBasedOn.REQUESTS, label: "Requests" },
  { value: OperationsFetchBasedOn.LATENCY, label: "P95 Latency" },
  { value: OperationsFetchBasedOn.ERRORS, label: "Errors" },
];

export const OperationsSearch = ({
  searchQuery,
  onSearchQueryChange,
  fetchBasedOn,
  onFetchBasedOnChange,
  sortDirection,
  onSortDirectionChange,
  includeDeprecatedFields,
  onIncludeDeprecatedFieldsChange,
  className,
}: OperationsSearchProps) => {
  const graphContext = useContext(GraphContext);
  const router = useRouter();
  const applyParams = useApplyParams();
  const { clientNames, applyClientNameFilter } = useOperationsFilters([]);

  // Fetch clients for the filter
  const { data: clientsData } = useQuery(
    getClientsFromAnalytics,
    {
      namespace: graphContext?.graph?.namespace,
      federatedGraphName: graphContext?.graph?.name,
    },
    {
      enabled: !!graphContext?.graph?.name,
    },
  );

  // Get current page number
  const pageNumber = useMemo(() => {
    const page = parseInt(router.query.page as string, 10);
    return isNaN(page) || page < 1 ? 1 : page;
  }, [router.query.page]);

  const clients = useMemo(
    () => clientsData?.clients || [],
    [clientsData?.clients],
  );

  const handleClearSearch = useCallback(() => {
    onSearchQueryChange("");
  }, [onSearchQueryChange]);

  const handleSortDirectionToggle = useCallback(() => {
    const newDirection = sortDirection === "desc" ? "asc" : "desc";
    onSortDirectionChange(newDirection);
  }, [sortDirection, onSortDirectionChange]);

  const handleDeprecatedFieldsFilterSelect = useCallback(
    (value?: string[]) => {
      onIncludeDeprecatedFieldsChange(!!value && value.length > 0);
    },
    [onIncludeDeprecatedFieldsChange],
  );

  const handleClientNameFilterSelect = useCallback(
    (value?: string[]) => {
      // value is already an array from the filter component
      applyClientNameFilter(value && value.length > 0 ? value : null);
      // Reset to page 1 when client filter changes
      if (pageNumber !== 1) {
        applyParams({ page: "1" });
      }
    },
    [applyClientNameFilter, pageNumber, applyParams],
  );

  const filtersList: AnalyticsFilter[] = useMemo(
    () => [
      {
        id: "clientName",
        title: "Client",
        options: clients.map((client) => ({
          label: client.name,
          value: client.name,
        })),
        selectedOptions: clientNames || [],
        onSelect: handleClientNameFilterSelect,
      },
      {
        id: "deprecatedFields",
        title: "Operations with deprecated fields",
        options: [],
        selectedOptions: includeDeprecatedFields ? ["true"] : [],
        onSelect: handleDeprecatedFieldsFilterSelect,
        customOptions: CustomOptions.Boolean,
      },
    ],
    [
      handleDeprecatedFieldsFilterSelect,
      handleClientNameFilterSelect,
      includeDeprecatedFields,
      clients,
      clientNames,
    ],
  );

  // Check if an operation is selected
  const hasSelectedOperation = useMemo(() => {
    return !!router.query.operationHash;
  }, [router.query.operationHash]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      (clientNames && clientNames.length > 0) ||
      includeDeprecatedFields ||
      hasSelectedOperation
    );
  }, [clientNames, includeDeprecatedFields, hasSelectedOperation]);

  // Reset all filters and operation selection
  const handleResetFilters = useCallback(() => {
    // Clear all filters and operation selection in a single update
    applyParams({
      clientNames: null,
      includeDeprecatedFields: null,
      operationHash: null,
      operationName: null,
      page: pageNumber !== 1 ? "1" : null,
    });
  }, [applyParams, pageNumber]);

  return (
    <div className={`w-full space-y-4 ${className}`}>
      {/* Search Bar */}
      <div className="relative w-full">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search operations by name or hash..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="w-full pl-10 pr-10"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearSearch}
            className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0 hover:bg-muted"
            aria-label="Clear search"
          >
            <XMarkIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Filters and Sort Controls */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <AnalyticsFilters filters={filtersList} className="w-72" />
          {hasActiveFilters && (
            <Button
              onClick={handleResetFilters}
              variant="outline"
              size="sm"
              className="border-dashed"
            >
              <Cross2Icon className="mr-2 h-4 w-4" />
              Reset
            </Button>
          )}
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSortDirectionToggle}
            className="h-6 w-6"
            aria-label={`Sort ${
              sortDirection === "desc" ? "ascending" : "descending"
            }`}
          >
            {sortDirection === "desc" ? (
              <BarsArrowDownIcon className="h-4 w-4" />
            ) : (
              <BarsArrowUpIcon className="h-4 w-4" />
            )}
          </Button>
          <Select
            value={fetchBasedOn.toString()}
            onValueChange={(value) =>
              onFetchBasedOnChange(Number(value) as OperationsFetchBasedOn)
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};
