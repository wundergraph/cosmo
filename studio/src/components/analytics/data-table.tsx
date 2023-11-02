import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import { ClockIcon, Cross2Icon, UpdateIcon } from "@radix-ui/react-icons";
import {
  ColumnFiltersState,
  PaginationState,
  Row,
  SortingState,
  VisibilityState,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { formatISO, subDays, subHours } from "date-fns";
import { useRouter } from "next/router";
import {
  AnalyticsViewColumn,
  AnalyticsViewFilterOperator,
  AnalyticsViewGroupName,
  AnalyticsViewResultFilter,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import React, { useCallback, useState } from "react";

import useDeepCompareEffect from "use-deep-compare-effect";
import {
  DatePickerWithRange,
  Range,
  DateRange,
  DateRangePickerChangeHandler,
} from "../date-picker-with-range";
import { Loader } from "../ui/loader";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableGroupMenu } from "./data-table-group-menu";
import { DataTablePagination } from "./data-table-pagination";
import { DataTablePrimaryFilterMenu } from "./data-table-primary-filter-menu";
import { getColumnData } from "./getColumnData";
import { getDataTableFilters } from "./getDataTableFilters";
import { getDefaultSort, useSyncTableWithQuery } from "./useSyncTableWithQuery";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { AnalyticsFilters, AnalyticsSelectedFilters } from "./filters";
import { useApplyParams } from "./use-apply-params";
import { RefreshInterval, refreshIntervals } from "./refresh-interval";

export function AnalyticsDataTable<T>({
  data,
  columnsList,
  filters,
  isFetching,
  isLoading,
  pageCount,
  refresh,
}: {
  data: T[];
  columnsList: AnalyticsViewColumn[];
  filters: Array<AnalyticsViewResultFilter>;
  isFetching: boolean;
  isLoading: boolean;
  pageCount: number;
  refresh: () => void;
}) {
  const router = useRouter();

  const [, setRouteCache] = useSessionStorage("analytics.route", router.query);

  const [refreshInterval, setRefreshInterval] = useState(
    refreshIntervals[0].value
  );

  const [sorting, setSorting] = React.useState<SortingState>(
    getDefaultSort(router.query.group?.toString())
  );

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [selectedGroup, setSelectedGroup] =
    React.useState<AnalyticsViewGroupName>(AnalyticsViewGroupName.None);

  const [selectedRange, setRange] = React.useState<Range | undefined>();
  const [selectedDateRange, setDateRange] = React.useState<DateRange>({
    start: subHours(new Date(), Number(router.query.range ?? 24)),
    end: new Date(),
  });

  const columns = getColumnData(columnsList);

  const defaultHiddenColumns = columnsList
    .filter((each) => each.isHidden)
    .reduce((acc, item) => {
      // @ts-expect-error
      acc[item.name] = false;
      return acc;
    }, {});

  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(defaultHiddenColumns);

  useDeepCompareEffect(() => {
    setColumnVisibility(defaultHiddenColumns);
  }, [defaultHiddenColumns]);

  const [rowSelection, setRowSelection] = React.useState({});

  const [{ pageIndex, pageSize }, setPagination] =
    React.useState<PaginationState>({
      pageIndex: 0,
      pageSize: 10,
    });

  const pagination = React.useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize]
  );

  const state = {
    sorting,
    columnFilters,
    columnVisibility,
    rowSelection,
    pagination,
  };

  const applyNewParams = useApplyParams();

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state,
    maxMultiSortColCount: 1,
    manualPagination: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (t) => {
      if (typeof t === "function") {
        const newVal = functionalUpdate(t, state.pagination);
        applyNewParams({
          page: newVal.pageIndex.toString(),
          pageSize: newVal.pageSize.toString(),
        });
      }
    },
    onColumnFiltersChange: (t) => {
      if (typeof t === "function") {
        const newVal = functionalUpdate(t, state.columnFilters);
        let stringifiedFilters;
        try {
          stringifiedFilters = JSON.stringify(newVal);
        } catch {
          stringifiedFilters = "[]";
        }
        applyNewParams({
          filterState: stringifiedFilters,
        });
      }
    },
    onSortingChange: (t) => {
      if (typeof t === "function") {
        const newVal = functionalUpdate(t, state.sorting);
        const defaultSort = getDefaultSort();
        if (newVal.length) {
          applyNewParams({
            sort: newVal[0]?.id,
            sortDir: newVal[0]?.desc ? "desc" : "asc",
          });
        } else if (defaultSort[0].id === state.sorting[0].id) {
          applyNewParams(
            {
              sort: defaultSort[0].id,
              sortDir: defaultSort[0]?.desc ? "asc" : "desc",
            },
            ["sort", "sortDir"]
          );
        } else {
          applyNewParams({}, ["sort", "sortDir"]);
        }
      }
    },
  });

  const onGroupChange = (val: AnalyticsViewGroupName) => {
    applyNewParams(
      {
        group: AnalyticsViewGroupName[val],
      },
      ["sort", "sortDir"]
    );
  };

  const onDateRangeChange: DateRangePickerChangeHandler = ({
    range,
    dateRange,
  }) => {
    if (range) {
      applyNewParams({
        dateRange: null,
        range: range.toString(),
      });
    } else if (dateRange) {
      const stringifiedDateRange = JSON.stringify({
        start: formatISO(dateRange.start as Date),
        end: formatISO((dateRange.end as Date) ?? (dateRange.start as Date)),
      });

      applyNewParams({
        dateRange: stringifiedDateRange,
        range: null,
      });
    }
  };

  const onRefreshIntervalChange = (val?: number) => {
    applyNewParams({
      refreshInterval: val ? String(val) : null,
    });
    setRefreshInterval(val);
  };

  const filtersList = getDataTableFilters(table, filters);
  const selectedFilters = table.getState().columnFilters;

  useSyncTableWithQuery({
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
    onRefreshIntervalChange,
    refreshInterval,
  });

  const relinkTable = (row: Row<any>) => {
    const newQueryParams: Record<string, string> = {};

    const setFilterOn = (columnName: string) => {
      const col = table.getColumn(columnName);
      const val = row.getValue(col?.id ?? "") as string;

      const stringifiedFilters = JSON.stringify([
        {
          id: columnName,
          value: [
            JSON.stringify({
              label: val || "-",
              operator: AnalyticsViewFilterOperator.EQUALS,
              value: val || "",
            }),
          ],
        },
      ]);
      newQueryParams["filterState"] = stringifiedFilters;
    };

    switch (selectedGroup) {
      case AnalyticsViewGroupName.None: {
        const { slug } = router.query;
        const { organizationSlug } = router.query;

        // Save the current route in sessionStorage so we can go back to it
        setRouteCache(router.query);

        router.push(
          `/${organizationSlug}/graph/${slug}/analytics/${row.getValue(
            "traceId"
          )}`
        );
        return;
      }
      case AnalyticsViewGroupName.Client: {
        setFilterOn("clientName");
        break;
      }
      case AnalyticsViewGroupName.HttpStatusCode: {
        setFilterOn("httpStatusCode");
        break;
      }
      default: {
        setFilterOn("operationName");
      }
    }
    newQueryParams["group"] =
      AnalyticsViewGroupName[AnalyticsViewGroupName.None];

    applyNewParams(newQueryParams, ["sort", "sortDir"]);
  };

  return (
    <div>
      <div className="flex flex-row flex-wrap items-start gap-y-2">
        <div className="flex flex-1 flex-row flex-wrap items-center gap-2">
          <DatePickerWithRange
            range={selectedRange}
            dateRange={selectedDateRange}
            onChange={onDateRangeChange}
          />
          <AnalyticsFilters filters={filtersList} />
        </div>
        <div className="flex flex-row flex-wrap items-start gap-2">
          <DataTableGroupMenu
            value={selectedGroup}
            onChange={onGroupChange}
            items={[
              {
                label: "None",
                value: AnalyticsViewGroupName.None,
              },
              {
                label: "Operation Name",
                value: AnalyticsViewGroupName.OperationName,
              },
              {
                label: "Client",
                value: AnalyticsViewGroupName.Client,
              },
              {
                label: "Http Status Code",
                value: AnalyticsViewGroupName.HttpStatusCode,
              },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                Columns <ChevronDownIcon className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {columnsList.find((each) => each.name === column.id)
                        ?.title ?? column.id}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            isLoading={isLoading || isFetching}
            size="icon"
            variant="outline"
            onClick={() => refresh()}
          >
            <UpdateIcon />
          </Button>
          <RefreshInterval
            value={refreshInterval}
            onChange={onRefreshIntervalChange}
          />
        </div>
      </div>
      <div className="flex flex-row flex-wrap items-start gap-y-2 py-2">
        <AnalyticsSelectedFilters
          filters={filtersList}
          selectedFilters={selectedFilters}
          onReset={() => table.resetColumnFilters()}
        />
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                onClick={() => relinkTable(row)}
                className="cursor-pointer hover:bg-secondary/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : isLoading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                <Loader />
              </TableCell>
            </TableRow>
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <DataTablePagination table={table} />
    </div>
  );
}
