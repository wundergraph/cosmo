import { useCallback } from 'react';
import { parseAsArrayOf, parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { OperationsFetchBasedOn } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

const fetchBasedOnValues = ['requests', 'latency', 'errors'] as const;

type FetchBasedOn = (typeof fetchBasedOnValues)[number];

const fetchBasedOnEnum = {
  requests: OperationsFetchBasedOn.REQUESTS,
  latency: OperationsFetchBasedOn.LATENCY,
  errors: OperationsFetchBasedOn.ERRORS,
} as const satisfies Record<FetchBasedOn, OperationsFetchBasedOn>;

const enumToString = (enumValue: OperationsFetchBasedOn): FetchBasedOn =>
  (Object.keys(fetchBasedOnEnum) as FetchBasedOn[]).find((key) => fetchBasedOnEnum[key] === enumValue) ?? 'requests';

export const operationsFilterParams = {
  includeOperationsWithDeprecatedFieldsOnly: parseAsBoolean.withDefault(false),
  operationHash: parseAsString,
  operationName: parseAsString,
  clientNames: parseAsArrayOf(parseAsString).withDefault([]),
  searchQuery: parseAsString.withDefault(''),
  fetchBasedOn: parseAsStringLiteral(fetchBasedOnValues).withDefault('requests'),
  sortDirection: parseAsString.withDefault('desc'),
};

export const useOperationsFilters = () => {
  const [filters, setFilters] = useQueryStates(operationsFilterParams);

  const applyDeprecatedFieldsFilter = useCallback(
    (includeOperationsWithDeprecatedFieldsOnly: boolean) => {
      setFilters({
        includeOperationsWithDeprecatedFieldsOnly,
        // Enabling the filter can hide the selected operation, so the selection goes with it.
        ...(includeOperationsWithDeprecatedFieldsOnly ? { operationHash: null, operationName: null } : {}),
      });
    },
    [setFilters],
  );

  const applySorting = useCallback(
    (fetchBasedOn: OperationsFetchBasedOn, sortDirection: string) => {
      setFilters({ fetchBasedOn: enumToString(fetchBasedOn), sortDirection: sortDirection || null });
    },
    [setFilters],
  );

  return {
    applyDeprecatedFieldsFilter,
    applySorting,
    includeOperationsWithDeprecatedFieldsOnly: filters.includeOperationsWithDeprecatedFieldsOnly,
    clientNames: filters.clientNames,
    searchQuery: filters.searchQuery,
    fetchBasedOn: fetchBasedOnEnum[filters.fetchBasedOn],
    fetchBasedOnStr: filters.fetchBasedOn,
    sortDirection: filters.sortDirection,
  };
};
