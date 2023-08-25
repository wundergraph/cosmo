import { cn } from "@/lib/utils";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { DropdownMenuItemProps } from "@radix-ui/react-dropdown-menu";
import { ClipboardCopyIcon } from "@radix-ui/react-icons";
import { ColumnDef } from "@tanstack/react-table";
import copy from "copy-to-clipboard";
import { formatInTimeZone } from "date-fns-tz";
import compact from "lodash/compact";
import {
  AnalyticsViewColumn,
  Unit,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import React, { ReactNode } from "react";
import { SchemaViewer } from "../schema-viewer";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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

export const mapStatusCode: Record<string, string> = {
  STATUS_CODE_UNSET: "Success",
  STATUS_CODE_OK: "Success",
  STATUS_CODE_ERROR: "Error",
};

const formatColumnData = (data: string | number, type: Unit): ReactNode => {
  if (!data) return "-";

  if (type === Unit.Unspecified) return data;

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
                "MMM dd yyyy HH:mm:ss"
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

/**
 * Fix for multiple dialog boxes on dropdowns based on
 * https://codesandbox.io/embed/r9sq1q
 */
const DialogItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps & { triggerChildren: ReactNode; title: string }
>((props, forwardedRef) => {
  const { triggerChildren, children, onSelect, title, ...itemProps } = props;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <DropdownMenuItem
          {...itemProps}
          ref={forwardedRef}
          onSelect={(event) => {
            event.preventDefault();
            onSelect && onSelect(event);
          }}
        >
          {triggerChildren}
        </DropdownMenuItem>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {children}
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
});

DialogItem.displayName = "DialogItem";

const QueryContent = ({ query }: { query: string }) => {
  return (
    <>
      <div className="scrollbar-custom !my-4 max-h-[70vh] overflow-auto rounded border">
        <SchemaViewer sdl={query} disableLinking />
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
        className
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
  columnData: AnalyticsViewColumn[]
): ColumnDef<any>[] => {
  const actionColumns: AnalyticsViewColumn[] = [];

  const columns: ColumnDef<any>[] = compact(
    columnData.map((each) => {
      if (each.isCta) {
        actionColumns.push(each);
        return null;
      }

      return {
        accessorKey: each.name,
        header: () => <div className="text-left">{each.title}</div>,
        cell: ({ row }: { row: any }) => {
          return (
            <div>{formatColumnData(row.getValue(each.name), each.unit!)}</div>
          );
        },
        filterFn: defaultFilterFn,
      };
    })
  );

  if (actionColumns.length) {
    const actionColumn: ColumnDef<any> = {
      id: "actions",
      enableHiding: false,
      header: () => <div className="text-center">Actions</div>,
      cell: ({ row }) => {
        const rowData = row.original;

        return (
          <DropdownMenu>
            <div className="flex justify-center">
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <EllipsisVerticalIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {actionColumns.map((action, actionIndex) => {
                return (
                  <DialogItem
                    title={action.title}
                    key={actionIndex.toString()}
                    triggerChildren={<span>{action.title}</span>}
                  >
                    {action.unit === Unit.CodeBlock ? (
                      <QueryContent query={rowData[action.name]} />
                    ) : (
                      <TextContent text={rowData[action.name]} />
                    )}
                  </DialogItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    };

    columns.push(actionColumn);
  }

  return columns;
};
