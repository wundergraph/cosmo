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
import { useCallback, useMemo } from "react";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { optionConstructor } from "@/components/analytics/getDataTableFilters";
import {
  AnalyticsViewFilterOperator,
  OperationsFetchBasedOn,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import type { AnalyticsFilter } from "@/components/analytics/filters";

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

  const deprecatedFieldsFilterOptions = useMemo(
    () => [
      optionConstructor({
        label: "Operations with deprecated fields",
        operator: AnalyticsViewFilterOperator.EQUALS as unknown as string,
        value: "true",
      }),
    ],
    [],
  );

  const selectedDeprecatedFieldsOptions = useMemo(
    () =>
      includeDeprecatedFields && deprecatedFieldsFilterOptions.length > 0
        ? [deprecatedFieldsFilterOptions[0].value]
        : [],
    [includeDeprecatedFields, deprecatedFieldsFilterOptions],
  );

  const filtersList: AnalyticsFilter[] = useMemo(
    () => [
      {
        id: "deprecatedFields",
        title: "Deprecated Fields",
        options: deprecatedFieldsFilterOptions,
        selectedOptions: selectedDeprecatedFieldsOptions,
        onSelect: handleDeprecatedFieldsFilterSelect,
      },
    ],
    [
      deprecatedFieldsFilterOptions,
      selectedDeprecatedFieldsOptions,
      handleDeprecatedFieldsFilterSelect,
    ],
  );

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
          >
            <XMarkIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Filters and Sort Controls */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <AnalyticsFilters filters={filtersList} />{" "}
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSortDirectionToggle}
            className="h-4 w-4"
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
