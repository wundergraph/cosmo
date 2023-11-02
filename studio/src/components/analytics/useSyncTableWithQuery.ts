import {
  ColumnFiltersState,
  PaginationState,
  SortingState,
  Table,
} from "@tanstack/react-table";
import { endOfDay, formatISO, startOfDay, subDays, subHours } from "date-fns";
import isEqual from "lodash/isEqual";
import { useRouter } from "next/router";
import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useEffect, useRef } from "react";
import { refreshIntervals } from "./refresh-interval";
import { DateRange, Range, getRange } from "../date-picker-with-range";

export const getDefaultSort = (group?: string) => {
  return group
    ? [
        {
          id: "totalRequests",
          desc: true,
        },
      ]
    : [
        {
          id: "unixTimestamp",
          desc: true,
        },
      ];
};

export const useSyncTableWithQuery = <T>({
  table,
  selectedGroup,
  setSelectedGroup,
  selectedRange,
  setRange,
  selectedDateRange,
  setDateRange,
  setColumnFilters,
  setSorting,
  pagination,
  setPagination,
  refreshInterval,
  onRefreshIntervalChange,
}: {
  table: Table<T>;
  selectedGroup: AnalyticsViewGroupName;
  setSelectedGroup: (val: AnalyticsViewGroupName) => void;
  selectedRange?: Range;
  setRange: (val?: Range) => void;
  selectedDateRange: DateRange;
  setDateRange: (newVal: DateRange) => void;
  setColumnFilters: (newVal: ColumnFiltersState) => void;
  setSorting: (state: SortingState) => void;
  pagination: PaginationState;
  setPagination: (newVal: PaginationState) => void;
  refreshInterval?: number;
  onRefreshIntervalChange: (ri?: number) => void;
}) => {
  const router = useRouter();

  const initial = useRef(true);

  const selectedFilters = table.getState().columnFilters;

  const currentPage = table.getState().pagination.pageIndex;

  const pageSize = table.getState().pagination.pageSize;

  const stringifiedDateRange = selectedDateRange
    ? JSON.stringify({
        from: formatISO(selectedDateRange.start),
        to: formatISO(selectedDateRange.end ?? selectedDateRange.start),
      })
    : undefined;

  useEffect(() => {
    if (router.isReady) {
      const filterStateFromUrl = JSON.parse(
        decodeURI((router.query.filterState as string) ?? "[]")
      );

      if (!isEqual(filterStateFromUrl, selectedFilters)) {
        setColumnFilters(filterStateFromUrl);
      }

      if (
        router.query.group &&
        AnalyticsViewGroupName[selectedGroup] !== router.query.group
      ) {
        setSelectedGroup(
          AnalyticsViewGroupName[
            router.query.group as string as keyof typeof AnalyticsViewGroupName
          ]
        );
      }

      let newPagination = pagination;
      if (
        router.query.pageSize &&
        router.query.pageSize !== pageSize.toString()
      ) {
        newPagination.pageSize = Number(router.query.pageSize);
      }
      if (router.query.page && router.query.page !== currentPage.toString()) {
        newPagination.pageIndex = Number(router.query.page) || 0;
      }
      setPagination(newPagination);

      const range = router.query.range?.toString();
      const parsedRange = getRange(range);

      if (
        router.query.dateRange &&
        router.query.dateRange !== stringifiedDateRange
      ) {
        let dateRangeObjectISO = {
          start: formatISO(startOfDay(subHours(new Date(), parsedRange))),
          end: formatISO(endOfDay(new Date())),
        };

        try {
          dateRangeObjectISO = JSON.parse(router.query.dateRange as string);
        } catch (e) {
          console.error(e);
        }

        // using the same (start/end) terminology here as in the api
        const start = new Date(dateRangeObjectISO.start);
        const end = new Date(dateRangeObjectISO.end);

        setDateRange({
          start,
          end,
        });
        setRange();
      } else if (!router.query.dateRange) {
        setRange(parsedRange);
      }

      if (
        router.query.refreshInterval &&
        Number(router.query.refreshInterval) !== refreshInterval
      ) {
        onRefreshIntervalChange(
          Number(router.query.refreshInterval) || refreshIntervals[0].value
        );
      }

      if (router.query.sort) {
        setSorting([
          {
            id: router.query.sort.toString(),
            desc: router.query.sortDir?.toString() !== "asc",
          },
        ]);
      } else {
        setSorting([]);
      }

      initial.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    router.isReady,
    router.query?.filterState,
    router.query.group,
    router.query.page,
    router.query.pageSize,
    router.query.range,
    router.query.dateRange,
    router.query.refreshInterval,
    router.query.sort,
    router.query.sortDir,
  ]);
};
