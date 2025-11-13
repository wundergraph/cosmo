import { Loader } from "@/components/ui/loader";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDurationMetric, formatMetric } from "@/lib/format-metric";
import { cn } from "@/lib/utils";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import copy from "copy-to-clipboard";
import _ from "lodash";
import { useState, useEffect, useRef } from "react";

interface Operation {
  hash: string;
  name: string;
  type: "query" | "mutation" | "subscription";
  latency: number;
  requestCount?: number;
  errorRate?: number;
  hasDeprecatedFields?: boolean;
}

interface OperationsListProps {
  operations: Operation[];
  selectedOperation: {
    hash: string;
    name: string;
  } | undefined;
  onOperationSelect: (operationHash: string, operationName: string) => void;
  isLoading?: boolean;
  searchQuery?: string;
  className?: string;
  sortField?: string;
}

const OperationTypeLetter = ({ type }: { type: Operation["type"] }) => {
  const getLetter = () => {
    switch (type) {
      case "query":
        return "Q";
      case "mutation":
        return "M";
      case "subscription":
        return "S";
      default:
        return "?";
    }
  };

  return (
    <span className="text-xs font-semibold text-muted-foreground">
      {getLetter()}
    </span>
  );
};

const OperationItem = ({
  operation,
  isSelected,
  onClick,
  searchQuery,
  sortField = "requests",
}: {
  operation: Operation;
  isSelected: boolean;
  onClick: () => void;
  searchQuery?: string;
  sortField?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState<boolean | undefined>(
    undefined,
  );
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const secondTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const highlightText = (text: string, query: string) => {
    if (!query) return text;

    const safeQuery = _.escapeRegExp(query);
    const regex = new RegExp(`(${safeQuery})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <span key={index} className="bg-yellow-200 dark:bg-yellow-900">
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  // Cleanup timeouts on unmount or when component updates
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (secondTimeoutRef.current) {
        clearTimeout(secondTimeoutRef.current);
      }
    };
  }, []);

  const handleHashClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the operation selection

    // Clear any existing timeouts
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (secondTimeoutRef.current) {
      clearTimeout(secondTimeoutRef.current);
    }

    copy(operation.hash);
    setCopied(true);
    // Always ensure tooltip is open when clicked
    setTooltipOpen(true);

    timeoutRef.current = setTimeout(() => {
      // Close tooltip first while still showing "Copied!"
      setTooltipOpen(false);
      // Then reset copied state after tooltip closes
      secondTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        setTooltipOpen(undefined); // Return to uncontrolled state
      }, 200); // Wait for tooltip close animation
    }, 1000);
  };

  const getSelectedMetric = () => {
    switch (sortField) {
      case "requests":
        return operation.requestCount
          ? `${formatMetric(operation.requestCount)} Req`
          : null;
      case "latency":
        return formatDurationMetric(operation.latency);
      case "errors":
        return operation.errorRate && operation.errorRate > 0
          ? `${operation.errorRate.toFixed(2)}%`
          : null;
      default:
        return null;
    }
  };

  const selectedMetric = getSelectedMetric();

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded border px-3 py-2 transition-all hover:bg-muted/50",
        isSelected && "border-primary bg-muted",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <OperationTypeLetter type={operation.type} />
          <p className="truncate text-sm font-medium">
            {searchQuery
              ? highlightText(
                  operation.name || "Unnamed Operation",
                  searchQuery,
                )
              : operation.name || "Unnamed Operation"}
          </p>
          <Tooltip
            delayDuration={100}
            open={tooltipOpen}
            onOpenChange={(open) => {
              // If we're in copied state and trying to close, prevent it
              if (copied && !open) {
                return; // Keep tooltip open while showing "Copied!"
              }
              // Normal hover behavior - allow opening/closing
              setTooltipOpen(open ? true : undefined);
            }}
          >
            <TooltipTrigger asChild>
              <code
                onClick={handleHashClick}
                className="flex-shrink-0 cursor-pointer rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted-foreground/20"
              >
                {searchQuery
                  ? highlightText(operation.hash.slice(0, 4), searchQuery)
                  : `${operation.hash.slice(0, 4)}`}
              </code>
            </TooltipTrigger>
            <TooltipContent>
              <p>{copied ? "Copied!" : "Copy Operation Hash"}</p>
            </TooltipContent>
          </Tooltip>
          {operation.hasDeprecatedFields && (
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <ExclamationTriangleIcon className="h-3.5 w-3.5 flex-shrink-0 cursor-help text-warning" />
              </TooltipTrigger>
              <TooltipContent>
                <p>This operation uses deprecated fields</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {selectedMetric && (
          <div className="flex-shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">
            {selectedMetric}
          </div>
        )}
      </div>
    </div>
  );
};

export const OperationsList = ({
  operations,
  selectedOperation,
  onOperationSelect,
  isLoading = false,
  searchQuery,
  className,
  sortField = "requests",
}: OperationsListProps) => {
  if (isLoading) {
    return (
      <div className={cn("flex h-64 items-center justify-center", className)}>
        <Loader />
      </div>
    );
  }

  if (operations.length === 0) {
    return (
      <div className="space-y-2 pt-6 text-center">
        <p className="text-sm text-muted-foreground">
          {searchQuery
            ? "No operations found matching your search"
            : "No operations found"}
        </p>
        {searchQuery && (
          <p className="text-xs text-muted-foreground">
            Try adjusting your search terms or filters
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto scrollbar-none">
      <div className="w-full space-y-1">
        {operations.map((operation) => {
          // Match by hash and name
          // If selectedOperationName is null/undefined, it means no name filter was set (legacy or from URL without name)
          // In that case, match by hash only
          // If selectedOperationName is an empty string, it means an unnamed operation was explicitly selected
          // In that case, only match operations with empty name
          // If selectedOperationName has a value, match operations with that exact name
          const operationName = operation.name || "";
          const isSelected =
            selectedOperation?.hash === operation.hash &&
            (selectedOperation?.name === null ||
            selectedOperation?.name === undefined
              ? true // No name filter set, match by hash only
              : selectedOperation?.name === operationName); // Name filter exists, match exact name

          return (
            <OperationItem
              key={`${operation.hash}-${operation.name || ""}`}
              operation={operation}
              isSelected={isSelected}
              onClick={() =>
                onOperationSelect(operation.hash, operation.name || "")
              }
              searchQuery={searchQuery}
              sortField={sortField}
            />
          );
        })}
      </div>
    </div>
  );
};
