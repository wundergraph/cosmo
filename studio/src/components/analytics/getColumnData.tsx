import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { ClipboardCopyIcon } from "@radix-ui/react-icons";
import { ColumnDef } from "@tanstack/react-table";
import {
  AnalyticsViewColumn,
  Unit,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import copy from "copy-to-clipboard";
import { formatInTimeZone } from "date-fns-tz";
import compact from "lodash/compact";
import React, { ReactNode, useState } from "react";
import { CodeViewer } from "../code-viewer";
import { Button } from "../ui/button";
import { Dialog2, Dialog2Content, Dialog2Title } from "../ui/dialog2";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useToast } from "../ui/use-toast";
import { nanoTimestampToTime } from "./charts";
import { defaultFilterFn } from "./defaultFilterFunction";
import { InfoTooltip } from "@/components/info-tooltip";

export const mapStatusCode: Record<string, string> = {
  STATUS_CODE_UNSET: "Unset",
  STATUS_CODE_OK: "OK",
  STATUS_CODE_ERROR: "Error",
};

const columnConfig: Record<
  string,
  {
    header?: {
      className?: string;
    };
    cell?: {
      className?: string;
    };
    tooltipInfo?: ReactNode;
  }
> = {
  traceId: {
    header: {
      className: "w-[80]px",
    },
  },
  unixTimestamp: {
    header: {
      className: "w-[150px]",
    },
  },
  operationName: {
    cell: {
      className: "w-[200px] lg:w-[320px] truncate",
    },
  },
  actions: {
    header: {
      className: "w-[100]px",
    },
  },
  statusCode: {
    tooltipInfo: (
      <div>
        <ul>
          <li>OK: The operation was classified as successful.</li>
          <li>Error: The operation contains an error.</li>
          <li>Unset: The default value. Operation status was not set.</li>
        </ul>
      </div>
    ),
  },
};

const formatColumnData = (data: string | number, type: Unit): ReactNode => {
  if (!data) return "-";

  // If the type is unspecified, we just return the data as is in string format
  // In that way, we format e.g. boolean values as "true" or "false"
  if (type === Unit.Unspecified) return data.toString();

  if (type === Unit.StatusCode) {
    return <span>{mapStatusCode[data]}</span>;
  }

  if (type === Unit.TraceID) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="overflow-hidden text-ellipsis">
              {data.toString().substring(0, 7)}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <span>{data}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (type === Unit.UnixTimestamp) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              {formatInTimeZone(
                Number(data) * 1000,
                "UTC",
                "MMM dd yyyy HH:mm:ss",
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <span>{data}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (type === Unit.Nanoseconds) {
    return nanoTimestampToTime(data as number);
  }

  return data;
};

const ActionDialog = (props: {
  title: string;
  content: string;
  unit: Unit;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) => {
  const { content, title, unit } = props;
  return (
    <Dialog2 isOpen={props.isOpen} setIsOpen={props.setIsOpen}>
      <Dialog2Content className="max-w-2xl">
        <Dialog2Title>{title}</Dialog2Title>
        {unit === Unit.CodeBlock ? (
          <QueryContent query={content} />
        ) : (
          <TextContent text={content} />
        )}
      </Dialog2Content>
    </Dialog2>
  );
};

const ActionsDropdown = ({
  actionColumns,
  rowData,
}: {
  actionColumns: AnalyticsViewColumn[];
  rowData: any;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<
    | {
        title: string;
        content: string;
        unit: Unit;
      }
    | undefined
  >();

  return (
    <>
      <DropdownMenu>
        <div className="flex justify-center">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="table-action">
              <EllipsisVerticalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="end">
          {actionColumns.map((action) => {
            return (
              <DropdownMenuItem
                key={action.title}
                onClick={(e) => e.stopPropagation()}
                onSelect={() => {
                  setData({
                    title: action.title,
                    content: rowData[action.name],
                    unit: action.unit ?? Unit.Unspecified,
                  });
                  setIsOpen(true);
                }}
              >
                <span>{action.title}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {data && isOpen && (
        <ActionDialog {...data} isOpen={isOpen} setIsOpen={setIsOpen} />
      )}
    </>
  );
};

const QueryContent = ({ query }: { query: string }) => {
  return (
    <>
      <div className="scrollbar-custom !my-4 max-h-[70vh] overflow-auto rounded border">
        <CodeViewer code={query} disableLinking />
      </div>
      <DialogActions text={query} />
    </>
  );
};

const TextContent = ({ text }: { text: string }) => {
  return (
    <>
      <div className="scrollbar-custom !my-4 max-h-[70vh] overflow-auto rounded border">
        <pre className="whitespace-break-spaces p-2">{text}</pre>
      </div>
      <DialogActions text={text} />
    </>
  );
};

const DialogActions = ({
  text,
  className,
}: {
  text: string;
  className?: string;
}) => {
  const { toast, dismiss } = useToast();

  const copyText = () => {
    copy(text);
    const { id } = toast({ description: "Copied to clipboard" });

    const t = setTimeout(() => {
      dismiss(id);
    }, 2000);

    return () => clearTimeout(t);
  };

  return (
    <div
      className={cn(
        "flex w-full items-center gap-x-2 md:ml-auto md:w-auto",
        className,
      )}
    >
      <Button variant="secondary" className="flex-1" onClick={() => copyText()}>
        <ClipboardCopyIcon className="mr-3" />
        Copy
      </Button>
    </div>
  );
};

export const getColumnData = (
  columnData: AnalyticsViewColumn[],
): ColumnDef<any>[] => {
  const actionColumns: AnalyticsViewColumn[] = [];

  const columns: ColumnDef<any>[] = compact(
    columnData.map((each) => {
      if (each.isCta) {
        actionColumns.push(each);
        return null;
      }

      const config = columnConfig[each.name] || {};

      return {
        accessorKey: each.name,
        header: ({ header }) => {
          let sortedProps: Record<string, any> = {};

          const sorted = header.column.getIsSorted();

          if (header.column.getCanSort()) {
            sortedProps = {
              className: "select-none cursor-pointer hover:text-foreground",
              onClick: header.column.getToggleSortingHandler(),
            };
          }

          return (
            <div
              {...sortedProps}
              className={cn(
                "inline-flex items-center space-x-1 text-left",
                config?.header?.className,
                sortedProps?.className,
              )}
            >
              <span className="flex items-center space-x-1">
                <span>{each.title}</span>
                {config.tooltipInfo && (
                  <span>
                    <InfoTooltip>{config.tooltipInfo}</InfoTooltip>
                  </span>
                )}
              </span>

              <span className="inline-block w-3">
                {sorted ? (
                  sorted === "desc" ? (
                    <ChevronDownIcon className="h-3 w-3" />
                  ) : (
                    <ChevronUpIcon className="h-3 w-3" />
                  )
                ) : null}
              </span>
            </div>
          );
        },
        cell: ({ row }) => {
          return (
            <div className={cn(config?.cell?.className)}>
              {formatColumnData(row.getValue(each.name), each.unit!)}
            </div>
          );
        },
        filterFn: defaultFilterFn,
      } satisfies ColumnDef<any>;
    }),
  );

  if (actionColumns.length) {
    const actionColumn: ColumnDef<any> = {
      id: "actions",
      enableHiding: false,
      header: () => <div className="text-center"></div>,
      cell: ({ row }) => {
        const rowData = row.original;

        return (
          <ActionsDropdown actionColumns={actionColumns} rowData={rowData} />
        );
      },
    };

    columns.push(actionColumn);
  }

  return columns;
};
