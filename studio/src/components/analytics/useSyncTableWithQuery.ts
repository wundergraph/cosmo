import {
  ColumnFiltersState,
  PaginationState,
  Table,
} from "@tanstack/react-table";
import { endOfDay, formatISO, startOfDay, subDays } from "date-fns";
import isEqual from "lodash/isEqual";
import { useRouter } from "next/router";
import { AnalyticsViewGroupName } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useEffect } from "react";
import { DateRange } from "react-day-picker";
import { refreshIntervals } from "./data-table";

export const useSyncTableWithQuery = <T>({
  table,
  selectedGroup,
  setSelectedGroup,
  selectedDateRange,
  setDateRange,
  setColumnFilters,
  pagination,
  setPagination,
  refreshInterval,
  onRefreshIntervalChange,
}: {
  table: Table<T>;
  selectedGroup: AnalyticsViewGroupName;
  setSelectedGroup: (val: AnalyticsViewGroupName) => void;
  selectedDateRange: DateRange;
  setDateRange: (newVal: DateRange) => unknown;
  setColumnFilters: (newVal: ColumnFiltersState) => void;
  pagination: PaginationState;
  setPagination: (newVal: PaginationState) => void;
  refreshInterval: (typeof refreshIntervals)[number];
  onRefreshIntervalChange: (ri: (typeof refreshIntervals)[number]) => void;
}) => {
  const router = useRouter();

  const selectedFilters = table.getState().columnFilters;

  const currentPage = table.getState().pagination.pageIndex;

  const pageSize = table.getState().pagination.pageSize;

  const stringifiedDateRange = JSON.stringify({
    from: formatISO(selectedDateRange.from as Date),
    to: formatISO(
      (selectedDateRange.to as Date) ?? (selectedDateRange.from as Date)
    ),
  });

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

      if (
        router.query.dateRange &&
        router.query.dateRange !== stringifiedDateRange
      ) {
        let dateRangeObjectISO = {
          from: formatISO(startOfDay(subDays(new Date(), 30))),
          to: formatISO(endOfDay(new Date())),
        };

        try {
          dateRangeObjectISO = JSON.parse(router.query.dateRange as string);
        } catch (e) {
          console.error(e);
        }

        const dateRangeObject = {
          from: new Date(dateRangeObjectISO.from),
          to: new Date(dateRangeObjectISO.to),
        };

        setDateRange(dateRangeObject);
      }

      if (
        router.query.refreshInterval &&
        router.query.refreshInterval !== JSON.stringify(refreshInterval)
      ) {
        let refreshIntervalObject = refreshIntervals[0];
        try {
          refreshIntervalObject = JSON.parse(
            router.query.refreshInterval as string
          );
        } catch (e) {
          console.error(e);
        }
        onRefreshIntervalChange(refreshIntervalObject);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    router.isReady,
    router.query?.filterState,
    router.query.group,
    router.query.page,
    router.query.pageSize,
    router.query.dateRange,
    router.query.refreshInterval,
  ]);
};
