import { nsToTime } from "@/lib/insights-helpers";
import { cn } from "@/lib/utils";
import {
  CubeIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { FetchNode } from "./types";

const bigintE3 = BigInt(1e3);
const bigintE2 = BigInt(1e2);
const initialCollapsedSpanDepth = 4;

export const FetchSpanNode = ({
  span,
  parentSpan,
  level,
  globalDuration,
  globalStartTime,
  isParentDetailsOpen,
  paneWidth,
}: {
  span: FetchNode;
  parentSpan?: FetchNode;
  level: number;
  globalDuration: bigint;
  globalStartTime: bigint;
  isParentDetailsOpen: boolean;
  paneWidth: number;
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const statusCode = span.outputTrace?.response?.statusCode ?? 0;

  const hasChildren = span.children && span.children.length > 0;
  const parentChildrenCount = parentSpan?.children
    ? parentSpan.children.length
    : 0;

  // Work with smaller units (picosecond) on numerator to circumvent bigint division
  const elapsedDurationPs = BigInt(span.durationSinceStart!) * bigintE3;
  const spanDurationPs = BigInt(span.durationLoad!) * bigintE3;
  const visualOffsetPercentage = Number(
    ((elapsedDurationPs / globalDuration) * bigintE2) / bigintE3,
  );
  const visualWidthPercentage = Number(
    ((spanDurationPs / globalDuration) * bigintE2) / bigintE3,
  );

  const [isOpen, setIsOpen] = useState(
    () => level <= initialCollapsedSpanDepth,
  );

  const hasChildrenError = (span: FetchNode) => {
    if (statusCode >= 400) {
      return true;
    }

    if (span.children) {
      return span.children.some(hasChildrenError);
    }

    return false;
  };

  const [isError, setIsError] = useState<boolean>(
    () => statusCode >= 400 || (!isOpen && hasChildrenError(span)),
  );

  const getDurationOffset = () => {
    const durationCharCount = (nsToTime(BigInt(span.durationLoad!)) as string)
      .length;
    if (visualWidthPercentage < 8 && durationCharCount < 9) {
      if (visualOffsetPercentage < 90) {
        return `calc(${visualOffsetPercentage + visualWidthPercentage + 2}%)`;
      }
      if (visualOffsetPercentage >= 90) {
        return `calc(${visualOffsetPercentage - visualWidthPercentage - 10}%)`;
      }
    }
    return `${visualOffsetPercentage + 2}%`;
  };

  const toggleTree = () => {
    setIsOpen((prevOpen) => {
      if (hasChildren) {
        if (prevOpen) {
          setIsError(hasChildrenError(span));
        } else {
          setIsError(statusCode >= 400);
        }
      }
      return !prevOpen;
    });
  };

  return (
    <ul
      style={{
        marginLeft: `${16}px`,
        minWidth: `${1200 - level * 32}px`,
      }}
      className={cn(
        `trace-ul relative before:-top-4 before:h-[34px] lg:max-w-none`,
        {
          "before:top-0 before:h-[18px]": isParentDetailsOpen,
          "before:!h-full": parentChildrenCount > 1,
          "pl-4": level > 1,
        },
      )}
    >
      <li
        className={cn("group relative", {
          "bg-accent pb-2": showDetails,
        })}
      >
        <div className="relative flex w-full flex-wrap">
          <div
            className="ml-2 flex flex-shrink-0 items-start gap-x-1 border-r border-input py-1"
            style={{
              width: `${paneWidth - level * 32}px`,
            }}
          >
            <Button
              size="icon"
              variant="outline"
              onClick={toggleTree}
              disabled={!hasChildren}
              className={cn(
                "mt-1.5 h-min w-min rounded-sm border border-input p-px",
                {
                  "border-none": !hasChildren,
                },
              )}
            >
              <>
                {hasChildren && isOpen && (
                  <MinusIcon className="h-3 w-3 flex-shrink-0" />
                )}
                {hasChildren && !isOpen && (
                  <PlusIcon className="h-3 w-3 flex-shrink-0" />
                )}
                {!hasChildren && <CubeIcon className="h-4 w-4 flex-shrink-0" />}
              </>
            </Button>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex flex-nowrap items-start gap-x-2 overflow-hidden rounded-md px-2 py-1 text-left text-sm group-hover:bg-accent group-hover:text-accent-foreground"
            >
              <TooltipProvider>
                <Tooltip delayDuration={500}>
                  <TooltipTrigger className="space-y-1">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-x-1">
                        {isError && (
                          <ExclamationTriangleIcon className="mt-1 h-4 w-4 text-destructive" />
                        )}
                        <div className="flex flex-1 items-center gap-x-1.5 truncate font-medium">
                          {span.dataSourceName || "-"}
                          {statusCode ? <Badge>{statusCode}</Badge> : <div />}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        width: `${paneWidth - level * 32 - 44}px`,
                      }}
                      className="truncate text-start text-xs"
                    >
                      <div className="text-xs text-muted-foreground">
                        {span.type}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{span.dataSourceName}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="group relative flex flex-1 items-center group-hover:brightness-90"
          >
            <div className="absolute h-px w-full bg-input" />
            <div
              style={{
                minWidth: "2px",
                maxWidth: "500px !important",
                width: `${visualWidthPercentage}%`,
                left: `${visualOffsetPercentage}%`,
                // backgroundColor: service?.color,
              }}
              className="z-8 absolute mx-2 h-3/5 max-h-6 rounded bg-primary/50"
            />
            <div
              style={{
                left: getDurationOffset(),
              }}
              className={cn("z-8 absolute bg-transparent text-xs", {
                "px-2": visualWidthPercentage < 8,
                "!text-white": visualWidthPercentage >= 8,
              })}
            >
              {nsToTime(BigInt(span.durationLoad!))}
            </div>
          </button>
        </div>
        {/* {showDetails && (
          <div className="my-2 flex px-4 pr-6">
            <div
              style={{
                width: `${paneWidth - level * 32}px`,
              }}
              className="flex flex-none flex-col gap-x-4 gap-y-1 overflow-hidden border-0 px-4 text-xs"
            >
              <Attribute key="spanID" name="spanID" value={span.spanID} />
              <Attribute
                key="timing"
                name="startTime"
                value={
                  parentSpan
                    ? nsToTime(span.timestamp - parentSpan.timestamp)
                    : nsToTime(BigInt(0))
                }
              />
              {span.statusCode && (
                <Attribute
                  key="status"
                  name="status"
                  value={mapStatusCode[span.statusCode]}
                />
              )}
            </div>
            <div className="grid grow grid-cols-2 place-content-between gap-x-4 gap-y-1 overflow-hidden border-0 px-4 text-xs">
              {span.statusMessage && (
                <Attribute
                  key="statusMessage"
                  name="statusMessage"
                  value={span.statusMessage}
                />
              )}
              {Object.entries(span.attributes ?? {})
                .sort((a, b) =>
                  a[0].toUpperCase().localeCompare(b[0].toUpperCase()),
                )
                .filter(([key, value], _) => !!value)
                .map(([key, value]) => {
                  return <Attribute key={key} name={key} value={value} />;
                })}
            </div>
          </div>
        )} */}
      </li>
      {hasChildren && isOpen && (
        <>
          {span.children?.map((child) => (
            <FetchSpanNode
              key={child.id}
              span={child}
              parentSpan={span}
              level={level + 1}
              globalDuration={globalDuration}
              globalStartTime={globalStartTime}
              isParentDetailsOpen={showDetails}
              paneWidth={paneWidth}
            />
          ))}
        </>
      )}
    </ul>
  );
};
