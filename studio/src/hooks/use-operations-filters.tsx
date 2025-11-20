import { useCallback } from "react";
import { useRouter } from "next/router";
import { OperationsFetchBasedOn } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useApplyParams } from "@/components/analytics/use-apply-params";

export const useOperationsFilters = () => {
  const router = useRouter();
  const applyNewParams = useApplyParams();

  // Operations-specific filter management
  const applyDeprecatedFieldsFilter = useCallback(
    (includeDeprecatedFields: boolean) => {
      const params: Record<string, string | null> = {
        includeDeprecatedFields: includeDeprecatedFields ? "true" : null,
      };

      // When enabling deprecated fields filter, clear operation selection
      if (includeDeprecatedFields) {
        // Clear operationHash and operationName from URL params
        params.operationHash = null;
        params.operationName = null;
      }

      applyNewParams(params);
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
  const clientNamesParam = (router.query.clientNames as string) || null;
  const clientNames = clientNamesParam
    ? clientNamesParam.split(",").filter((name) => name.length > 0)
    : [];
  const searchQuery = (router.query.searchQuery as string) || "";
  const fetchBasedOnStr = (router.query.fetchBasedOn as string) || "requests";
  const fetchBasedOn = stringToEnum(fetchBasedOnStr);
  const sortDirection = (router.query.sortDirection as string) || "desc";

  return {
    applyDeprecatedFieldsFilter,
    applySorting,
    includeDeprecatedFields,
    clientNames,
    searchQuery,
    fetchBasedOn,
    fetchBasedOnStr, // Keep string version for backward compatibility
    sortDirection,
  };
};
