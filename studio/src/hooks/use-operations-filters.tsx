import { useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import {
  AnalyticsViewResultFilter,
  AnalyticsViewFilterOperator,
  OperationsFetchBasedOn,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { AnalyticsFilter } from "@/components/analytics/filters";
import { optionConstructor } from "@/components/analytics/getDataTableFilters";

const useSelectedFilters = () => {
  const router = useRouter();

  const selectedFilters = useMemo(() => {
    try {
      return JSON.parse(router.query.filterState?.toString() ?? "[]");
    } catch {
      return [];
    }
  }, [router.query.filterState]);

  return selectedFilters as { id: string; value: string[] }[];
};

export const useOperationsFilters = (filters: AnalyticsViewResultFilter[]) => {
  const router = useRouter();

  const applyNewParams = useCallback(
    (newParams: Record<string, string | boolean | null>, unset?: string[]) => {
      // Get keys that are being set to null (should be removed)
      const keysToRemove = Object.keys(newParams).filter(
        (key) => newParams[key] === null || newParams[key] === undefined,
      );

      // Filter out removed keys and unset keys from existing query
      const q = Object.fromEntries(
        Object.entries(router.query).filter(
          ([key]) => !unset?.includes(key) && !keysToRemove.includes(key),
        ),
      );

      // Only include non-null values from newParams
      const cleanedNewParams = Object.fromEntries(
        Object.entries(newParams).filter(
          ([_, value]) => value !== null && value !== undefined,
        ),
      );

      router.push({
        query: {
          ...q,
          ...cleanedNewParams,
        },
      });
    },
    [router],
  );

  const selectedFilters = useSelectedFilters();

  const filtersList = (filters ?? []).map((filter) => {
    return {
      ...filter,
      id: filter.columnName,
      onSelect: (value) => {
        const newSelected = [...selectedFilters];

        const index = newSelected.findIndex((f) => f.id === filter.columnName);

        if (!value || value.length === 0) {
          if (index !== -1) {
            newSelected.splice(index, 1);
          }
        } else if (index !== -1 && newSelected[index]) {
          newSelected[index].value = value;
        } else {
          newSelected.push({
            id: filter.columnName,
            value: value ?? [],
          });
        }

        let stringifiedFilters;
        try {
          stringifiedFilters = JSON.stringify(newSelected);
        } catch {
          stringifiedFilters = "[]";
        }
        applyNewParams({
          filterState: stringifiedFilters,
        });
      },
      selectedOptions:
        selectedFilters.find(
          (f: { id: string; value: string[] }) => f.id === filter.columnName,
        )?.value ?? [],
      options: filter.options.map((each) =>
        optionConstructor({
          label: each.label || "-",
          operator: AnalyticsViewFilterOperator[each.operator] as string,
          value: each.value ?? "",
        }),
      ),
    } as AnalyticsFilter;
  });

  const resetFilters = () => {
    applyNewParams({
      filterState: null,
    });
  };

  // Operations-specific filter management
  const applyDeprecatedFieldsFilter = useCallback(
    (includeDeprecatedFields: boolean) => {
      applyNewParams({
        includeDeprecatedFields: includeDeprecatedFields ? "true" : null,
      });
    },
    [applyNewParams],
  );

  const applyClientNameFilter = useCallback(
    (clientName: string | null) => {
      applyNewParams({
        clientName: clientName || null,
      });
    },
    [applyNewParams],
  );

  const applySearchQuery = useCallback(
    (searchQuery: string) => {
      applyNewParams({
        searchQuery: searchQuery || null,
      });
    },
    [applyNewParams],
  );

  // Helper functions to convert between enum and string for URL params
  const enumToString = (enumValue: OperationsFetchBasedOn): string => {
    switch (enumValue) {
      case OperationsFetchBasedOn.REQUESTS:
        return "requests";
      case OperationsFetchBasedOn.LATENCY:
        return "latency";
      case OperationsFetchBasedOn.ERRORS:
        return "errors";
      default:
        return "requests";
    }
  };

  const stringToEnum = (str: string): OperationsFetchBasedOn => {
    switch (str) {
      case "requests":
        return OperationsFetchBasedOn.REQUESTS;
      case "latency":
        return OperationsFetchBasedOn.LATENCY;
      case "errors":
        return OperationsFetchBasedOn.ERRORS;
      default:
        return OperationsFetchBasedOn.REQUESTS;
    }
  };

  const applySorting = useCallback(
    (fetchBasedOn: OperationsFetchBasedOn, sortDirection: string) => {
      applyNewParams({
        fetchBasedOn: enumToString(fetchBasedOn) || null,
        sortDirection: sortDirection || null,
      });
    },
    [applyNewParams],
  );

  // Get current values from URL
  const includeDeprecatedFields =
    router.query.includeDeprecatedFields === "true";
  const clientName = (router.query.clientName as string) || null;
  const searchQuery = (router.query.searchQuery as string) || "";
  const fetchBasedOnStr = (router.query.fetchBasedOn as string) || "requests";
  const fetchBasedOn = stringToEnum(fetchBasedOnStr);
  const sortDirection = (router.query.sortDirection as string) || "desc";

  return {
    filtersList,
    selectedFilters,
    resetFilters,
    applyDeprecatedFieldsFilter,
    applyClientNameFilter,
    applySearchQuery,
    applySorting,
    includeDeprecatedFields,
    clientName,
    searchQuery,
    fetchBasedOn,
    fetchBasedOnStr, // Keep string version for backward compatibility
    sortDirection,
  };
};
