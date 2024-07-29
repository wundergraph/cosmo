import { nsToTime } from "@/lib/insights-helpers";
import {
  Service,
  mapServiceName,
  mapSpanKind,
  mapStatusCode,
  selectColor,
} from "@/lib/trace-utils";
import {
  CubeIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { Span } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { useCallback, useEffect, useState } from "react";
import { useMovable } from "react-move-hook";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { docsBaseURL } from "@/lib/constants";

interface SpanNode extends Span {
  children?: SpanNode[];
}

const initialPaneWidth = 360;
const initialCollapsedSpanDepth = 4;

const Attribute = ({ name, value }: { name: string; value: any }) => {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger>
          <div className="flex items-center gap-x-1">
            <span className="text-accent-foreground">{name}</span>{" "}
            <span className="text-accent-foreground">=</span>{" "}
            <span className="truncate text-accent-foreground/80">{value}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-lg">{value}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const bigintE3 = BigInt(1e3);
const bigintE2 = BigInt(1e2);

function Node({
  span,
  parentSpan,
  level,
  globalDuration,
  globalStartTime,
  isParentDetailsOpen,
  services,
  paneWidth,
}: {
  span: SpanNode;
  parentSpan?: SpanNode;
  level: number;
  globalDuration: bigint;
  globalStartTime: bigint;
  isParentDetailsOpen: boolean;
  services: Service[];
  paneWidth: number;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const hasChildren = span.children && span.children.length > 0;
  const parentChildrenCount = parentSpan?.children
    ? parentSpan.children.length
    : 0;

  // Work with smaller units (picosecond) on numerator to circumvent bigint division
  const elapsedDurationPs = (span.timestamp - globalStartTime) * bigintE3;
  const spanDurationPs = span.duration * bigintE3;
  const visualOffsetPercentage = Number(
    ((elapsedDurationPs / globalDuration) * bigintE2) / bigintE3,
  );
  const visualWidthPercentage = Number(
    ((spanDurationPs / globalDuration) * bigintE2) / bigintE3,
  );

  const [isOpen, setIsOpen] = useState(
    () => level <= initialCollapsedSpanDepth,
  );
  const service = services.find(
    (service) => service.name === mapServiceName(span.serviceName),
  );

  const hasChildrenError = (span: SpanNode) => {
    if (
      span.statusCode === "STATUS_CODE_ERROR" ||
      !!span.attributes?.httpStatusCode.startsWith("4")
    ) {
      return true;
    }
    if (span.children) {
      return span.children.some(hasChildrenError);
    }
    return false;
  };

  const [isError, setIsError] = useState<boolean>(
    () =>
      span.statusCode === "STATUS_CODE_ERROR" ||
      !!span.attributes?.httpStatusCode.startsWith("4") ||
      (!isOpen && hasChildrenError(span)),
  );

  const getDurationOffset = () => {
    const durationCharCount = (nsToTime(span.duration) as string).length;
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
          setIsError(
            span.statusCode === "STATUS_CODE_ERROR" ||
              !!span.attributes?.httpStatusCode.startsWith("4"),
          );
        }
      }
      return !prevOpen;
    });
  };

  return (
    <ul
      style={{
        marginLeft: `${16}px`,
        minWidth: `${1024 - level * 32}px`,
      }}
      className={clsx(
        `trace-ul relative before:-top-4 before:h-[34px] lg:max-w-none`,
        {
          "before:top-0 before:h-[18px]": isParentDetailsOpen,
          "before:!h-full": parentChildrenCount > 1,
          "pl-4": level > 1,
        },
      )}
    >
      <li
        className={clsx("group relative", {
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
              className={clsx(
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
                          <div>{service?.name}</div>{" "}
                          <div className="text-xs text-muted-foreground">
                            {mapSpanKind[span.spanKind]}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        width: `${paneWidth - level * 32 - 44}px`,
                      }}
                      className="truncate text-start text-xs"
                    >
                      {span.spanName}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-lg">
                    <div className="flex flex-col space-y-3">
                      <div>{span.spanName}</div>
                    </div>
                  </TooltipContent>
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
                backgroundColor: service?.color,
              }}
              className="z-8 absolute mx-2 h-3/5 max-h-6 rounded"
            />
            <div
              style={{
                left: getDurationOffset(),
              }}
              className={clsx("z-8 absolute bg-transparent text-xs", {
                "px-2": visualWidthPercentage < 8,
                "!text-white": visualWidthPercentage >= 8,
              })}
            >
              {nsToTime(span.duration)}
            </div>
          </button>
        </div>
        {showDetails && (
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
        )}
      </li>
      {hasChildren && isOpen && (
        <>
          {span.children?.map((child) => (
            <Node
              key={child.spanID}
              span={child}
              parentSpan={span}
              level={level + 1}
              globalDuration={globalDuration}
              globalStartTime={globalStartTime}
              isParentDetailsOpen={showDetails}
              paneWidth={paneWidth}
              services={services}
            />
          ))}
        </>
      )}
    </ul>
  );
}

const Trace = ({ spans }: { spans: Span[] }) => {
  const [traceTree, setTraceTree] = useState<SpanNode>();
  const [missingRootSpan, setMissingRootSpan] = useState<boolean>();
  const [globalDuration, setGlobalDuration] = useState(BigInt(0));
  const [globalStartTime, setGlobalStartTime] = useState(BigInt(0));

  const [detectedService, setDetectedServices] = useState<Service[]>([]);

  const [paneWidth, setPaneWidth] = useState(initialPaneWidth);

  const [mouseState, setMouseState] = useState({
    moving: false,
    position: { x: initialPaneWidth, y: 0 },
    delta: { x: 0, y: 0 },
  });

  const handleChange = useCallback((moveData: any) => {
    setMouseState((state) => ({
      moving: moveData.moving,
      position: moveData.stoppedMoving
        ? {
            ...state.position,
            x: state.position.x + moveData.delta.x,
            y: state.position.y + moveData.delta.y,
          }
        : state.position,
      delta: moveData.moving ? moveData.delta : undefined,
    }));

    if (!moveData.moving) {
      setPaneWidth((width) => width + moveData.delta.x);
      document.body.classList.remove("select-none");
    } else {
      document.body.classList.add("select-none");
    }
  }, []);

  const ref = useMovable({
    onChange: handleChange,
    axis: "x",
    bounds: "parent",
  });

  useEffect(() => {
    const services = new Set<string>();
    spans.forEach((s) => {
      services.add(s.serviceName);
    });

    const serviceArray: Service[] = [];
    let i = 1;
    services.forEach((serviceName) => {
      serviceArray.push({
        // The order is stable because spans are sorted by start time
        // and spans for the edge and node are always created in the same order
        color: selectColor(i),
        name: mapServiceName(serviceName),
      });
      i += 1;
    });

    setDetectedServices(serviceArray);
  }, [spans]);

  useEffect(() => {
    let gStartTimeNano = BigInt(Number.MAX_VALUE);
    let gEndTimeNano = BigInt(0);

    const buildSpanTree = (spans: SpanNode[]): SpanNode => {
      const spanMap = new Map<string, SpanNode>();
      for (const span of spans) {
        span.children = [];
        spanMap.set(span.spanID, span);

        // Figure out the min and max start and end time to draw the timeline
        if (span.timestamp < gStartTimeNano) {
          gStartTimeNano = span.timestamp;
        }
        const spanEndTimeNs = span.timestamp + span.duration;
        if (spanEndTimeNs > gEndTimeNano) {
          gEndTimeNano = spanEndTimeNs;
        }
      }

      // Add spans to the parent node children array
      for (const span of spans) {
        const parent = spanMap.get(span.parentSpanID);

        if (parent) {
          parent.children?.push(span);
        }
      }

      let rootSpan = null;

      // Spans are already sorted by start time
      const rootSpans = spans.filter((span) => !span.parentSpanID);

      // check if there is a root span
      if (rootSpans.length) {
        rootSpan = rootSpans[0];
      } else {
        // if there is no root span, we assume the first span is the root span
        rootSpan = spans[0];
      }

      return rootSpan;
    };

    if (!spans.length) {
      return;
    }

    const tree = buildSpanTree(spans);
    setTraceTree(tree);

    setMissingRootSpan(
      !!tree.parentSpanID &&
        !spans.find((span) => tree.parentSpanID === span.spanID),
    );

    setGlobalDuration(gEndTimeNano - gStartTimeNano);
    setGlobalStartTime(gStartTimeNano);
  }, [spans]);

  const verticalResizeStyle = {
    left: mouseState.moving
      ? paneWidth + mouseState.delta?.x
      : mouseState.position.x,
  };

  return (
    <div className="space-y-4">
      <div className="relative mt-8 flex w-full flex-col gap-y-1 rounded-md border p-3 text-sm  md:mt-0">
        <span className="absolute right-0 top-0 -mr-1 -mt-1 flex h-4 w-4 hover:cursor-progress">
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex h-4 w-4 rounded-full bg-primary"></span>
              </TooltipTrigger>
              <TooltipContent>Checking for new spans</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
        <div>
          <table className="table-auto">
            <tbody>
              <tr>
                <td className="pr-6">Spans</td>
                <td>
                  <div className="flex items-center gap-x-3">
                    <span>:</span>
                    <span>{spans.length}</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td className="pr-6">Services</td>
                <td>
                  <div className="flex items-center gap-x-3">
                    <span>:</span>
                    <div className="flex flex-wrap gap-x-3">
                      {detectedService.map((service) => {
                        return (
                          <span
                            key={service.name}
                            className="flex items-center gap-x-2"
                          >
                            <div
                              className={"h-4 w-4 rounded-sm bg-sky-300"}
                              style={{ backgroundColor: service.color }}
                            />
                            <span>{service.name}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </td>
              </tr>
              <tr>
                <td className="pr-6">Info</td>
                <td>
                  <div className="flex items-center gap-x-3">
                    <span>:</span>
                    {missingRootSpan ? (
                      <div>
                        <ExclamationTriangleIcon className="inline h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />{" "}
                        This trace has no root span. This can have several
                        causes.{" "}
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={
                            docsBaseURL +
                            "/router/open-telemetry#why-is-my-trace-incomplete"
                          }
                          className="text-primary"
                        >
                          Learn more.
                        </a>
                      </div>
                    ) : (
                      <span>-</span>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {traceTree && (
        <>
          <Card className="flex w-full flex-col overflow-hidden">
            <div className="scrollbar-custom relative resize-none overflow-x-auto">
              <div className="flex items-center px-4 py-4">
                <span
                  className="flex-shrink-0 pl-2"
                  style={{
                    width: `${paneWidth}px`,
                  }}
                >
                  Request
                </span>
                <span>Timing</span>
              </div>
              <hr className="w-full border-input" />

              <div className="absolute left-0 right-0 top-0 h-full">
                <div
                  ref={ref}
                  style={verticalResizeStyle}
                  className={clsx(
                    mouseState.moving ? "bg-primary" : "bg-transparent",
                    "absolute z-50 ml-[-9px] h-full w-[2px] cursor-col-resize border-l-2 border-transparent hover:bg-primary",
                  )}
                ></div>
              </div>

              <div className="pb-4 pr-4">
                <Node
                  span={traceTree}
                  level={1}
                  globalDuration={globalDuration}
                  globalStartTime={globalStartTime}
                  isParentDetailsOpen={false}
                  paneWidth={paneWidth}
                  services={detectedService}
                />
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default Trace;
