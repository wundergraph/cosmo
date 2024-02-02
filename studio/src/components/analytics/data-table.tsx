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
  TableWrapper,
} from "@/components/ui/table";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import { useSessionStorage } from "@/hooks/use-session-storage";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { UpdateIcon } from "@radix-ui/react-icons";
import {
  ColumnFiltersState,
  PaginationState,
  Row,
  SortingState,
  Table as TableInstance,
  VisibilityState,
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  AnalyticsViewColumn,
  AnalyticsViewFilterOperator,
  AnalyticsViewGroupName,
  AnalyticsViewResultFilter,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatISO, subHours } from "date-fns";
import { useRouter } from "next/router";
import { useImperativeHandle, useMemo, useState } from "react";
import useDeepCompareEffect from "use-deep-compare-effect";
import {
  DatePickerWithRange,
  DateRange,
  DateRangePickerChangeHandler,
  Range,
} from "../date-picker-with-range";
import { Loader } from "../ui/loader";
import { DataTableGroupMenu } from "./data-table-group-menu";
import { DataTablePagination } from "./data-table-pagination";
import { AnalyticsFilters, AnalyticsSelectedFilters } from "./filters";
import { getColumnData } from "./getColumnData";
import { getDataTableFilters } from "./getDataTableFilters";
import { RefreshInterval, refreshIntervals } from "./refresh-interval";
import { useApplyParams } from "./use-apply-params";
import { getDefaultSort, useSyncTableWithQuery } from "./useSyncTableWithQuery";
import { HiOutlineCheck } from "react-icons/hi2";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AnalyticsDataTable<T>({
  tableRef,
  data,
  columnsList,
  filters,
  isFetching,
  isLoading,
  pageCount,
  refresh,
}: {
  tableRef?: React.Ref<TableInstance<T>>;
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
    refreshIntervals[0].value,
  );

  const [sorting, setSorting] = useState<SortingState>(
    getDefaultSort(router.query.group?.toString()),
  );

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selectedGroup, setSelectedGroup] = useState<AnalyticsViewGroupName>(
    AnalyticsViewGroupName.None,
  );

  const [selectedRange, setRange] = useState<Range | undefined>();
  const [selectedDateRange, setDateRange] = useState<DateRange>({
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
    useState<VisibilityState>(defaultHiddenColumns);

  useDeepCompareEffect(() => {
    setColumnVisibility(defaultHiddenColumns);
  }, [defaultHiddenColumns]);

  const [rowSelection, setRowSelection] = useState({});

  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const pagination = useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize],
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
            ["sort", "sortDir"],
          );
        } else {
          applyNewParams({}, ["sort", "sortDir"]);
        }
      }
    },
  });

  useImperativeHandle(tableRef, () => table, [table]);

  const onGroupChange = (val: AnalyticsViewGroupName) => {
    applyNewParams(
      {
        group: AnalyticsViewGroupName[val],
      },
      ["sort", "sortDir"],
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
        // Save the current route in sessionStorage so we can go back to it
        setRouteCache(router.query);

        applyNewParams({
          traceID: row.getValue("traceId"),
        });
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

  const tracingRetention = useFeatureLimit("tracing-retention", 7);

  return (
    <div>
      <div className="flex flex-row flex-wrap items-start gap-y-2">
        <div className="flex flex-1 flex-row flex-wrap items-center gap-2">
          <DatePickerWithRange
            range={selectedRange}
            dateRange={selectedDateRange}
            onChange={onDateRangeChange}
            calendarDaysLimit={tracingRetention}
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
      <TableWrapper>
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
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    onClick={() => relinkTable(row)}
                    className={cn(
                      "group cursor-pointer hover:bg-secondary/30",
                      {
                        "bg-secondary/50":
                          row.original.traceId === router.query.traceID,
                        "bg-destructive/10":
                          row.original.statusCode === "STATUS_CODE_ERROR",
                      },
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      let icon = null;

                      if (cell.column.id === "statusCode") {
                        if (cell.getValue() === "STATUS_CODE_ERROR") {
                          icon = (
                            <TooltipProvider>
                              <Tooltip delayDuration={300}>
                                <TooltipTrigger>
                                  <ExclamationTriangleIcon className="h-4 w-4 text-destructive" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-lg">
                                  {row.getValue("statusMessage")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        } else {
                          icon = <HiOutlineCheck className="h-4 w-4" />;
                        }
                      }

                      return (
                        <TableCell key={cell.id}>
                          <div className="flex items-center space-x-2">
                            {icon}
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            ) : isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  <Loader />
                </TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableWrapper>
      <DataTablePagination table={table} />
    </div>
  );
}
