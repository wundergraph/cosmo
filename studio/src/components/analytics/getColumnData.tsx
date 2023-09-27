import { cn } from "@/lib/utils";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { ClipboardCopyIcon } from "@radix-ui/react-icons";
import { ColumnDef } from "@tanstack/react-table";
import {
  AnalyticsViewColumn,
  Unit,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import copy from "copy-to-clipboard";
import { formatInTimeZone } from "date-fns-tz";
import compact from "lodash/compact";
import { ReactNode, useState } from "react";
import { SchemaViewer } from "../schmea-viewer";
import { Button } from "../ui/button";
import { Dialog2, Dialog2Content, Dialog2Title } from "../ui/dialog2";
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
            <Button variant="ghost" size="icon">
              <EllipsisVerticalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            Actions
          </DropdownMenuLabel>
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
          <ActionsDropdown actionColumns={actionColumns} rowData={rowData} />
        );
      },
    };

    columns.push(actionColumn);
  }

  return columns;
};
