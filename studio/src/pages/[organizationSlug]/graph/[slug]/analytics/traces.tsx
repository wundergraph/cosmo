import { AnalyticsDataTable } from "@/components/analytics/data-table";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { useAnalyticsQueryState } from "@/components/analytics/useAnalyticsQueryState";
import { EmptyState } from "@/components/empty-state";
import {
  getGraphLayout,
  GraphContext,
  GraphPageLayout,
} from "@/components/layout/graph-layout";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NextPageWithLayout } from "@/lib/page";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import { getAnalyticsView } from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import { formatISO } from "date-fns";
import { useRouter } from "next/router";
import { useContext, useRef, useState } from "react";
import { useHotkeys } from "@saas-ui/use-hotkeys";
import { FiArrowUpLeft, FiChevronDown, FiChevronUp } from "react-icons/fi";
import TracePage from "./[traceID]";
import { CopyButton } from "@/components/ui/copy-button";
import { Table } from "@tanstack/react-table";
import { Kbd } from "@/components/ui/kbd";
import { Spacer } from "@/components/ui/spacer";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, SizeIcon } from "@radix-ui/react-icons";

export type OperationAnalytics = {
  name: string;
  content: string;
  operationType: number;
};

// For the network call we read purely from the query with useAnalyticsQueryState
// The data table should only set url params and not the state for filters and pagination
// The useSyncTableWithQuery is responsible to read from the query and set local state
// This way we avoid race conditions and repeated network calls

const TracesPage: NextPageWithLayout = () => {
  const graphContext = useContext(GraphContext);

  const tableRef = useRef<Table<any>>(null);

  const {
    name,
    filters,
    pagination,
    range,
    dateRange,
    page,
    refreshInterval,
    sort,
  } = useAnalyticsQueryState();

  const viewQuery = getAnalyticsView.useQuery({
    federatedGraphName: graphContext?.graph?.name,
    name,
    config: {
      filters,
      range,
      dateRange: {
        start: formatISO(dateRange.start),
        end: formatISO(dateRange.end),
      },
      pagination,
      sort,
    },
  });

  let { data, isFetching, isLoading, error, refetch } = useQuery({
    ...viewQuery,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: refreshInterval,
  });

  const rowData =
    data?.view?.rows.map((each) => {
      const entries = Object.entries(each.value);
      const row: {
        [key: string]: (typeof entries)[number]["1"]["kind"]["value"];
      } = {};

      for (const [key, valueObject] of entries) {
        row[key] = valueObject.kind.value;
      }
      return row;
    }) ?? [];

  if (!isLoading && (error || data?.response?.code !== EnumStatusCode.OK)) {
    return (
      <div className="my-auto">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title="Could not retrieve analytics data"
          description={
            data?.response?.details || error?.message || "Please try again"
          }
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <AnalyticsDataTable
        tableRef={tableRef}
        data={rowData}
        columnsList={data?.view?.columns ?? []}
        filters={data?.view?.filters ?? []}
        isFetching={isFetching}
        isLoading={isLoading}
        pageCount={data?.view?.pages ?? Number(page) + 1}
        refresh={() => refetch()}
      />
      <TraceSheet data={rowData} />
    </div>
  );
};

const sizes = {
  default: "lg:max-w-3xl xl:max-w-6xl",
  full: "max-w-full",
};

export const TraceSheet: React.FC<any> = (props) => {
  const router = useRouter();

  const traceId = router.query.traceID as string;

  const index = props.data.findIndex((r: any) => r.traceId === traceId);

  const [size, setSize] = useState<keyof typeof sizes>("default");

  const nextTrace = () => {
    if (index + 1 < props.data.length) {
      const newQuery = { ...router.query };
      newQuery["traceID"] = props.data[index + 1].traceId;
      router.replace({
        query: newQuery,
      });
    }
  };

  const previousTrace = () => {
    if (index - 1 >= 0) {
      const newQuery = { ...router.query };
      newQuery["traceID"] = props.data[index - 1].traceId;
      router.replace({
        query: newQuery,
      });
    }
  };

  useHotkeys(
    "K",
    () => {
      previousTrace();
    },
    {},
    [traceId],
  );

  useHotkeys(
    "J",
    () => {
      nextTrace();
    },
    {},
    [traceId],
  );

  return (
    <Sheet
      modal
      open={!!traceId}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          const newQuery = { ...router.query };
          delete newQuery["traceID"];
          router.replace({
            query: newQuery,
          });
        }
      }}
    >
      <SheetContent
        hideOverlay
        className={cn(
          "scrollbar-custom w-full max-w-full overflow-y-scroll shadow-xl sm:max-w-full",
          sizes[size],
        )}
      >
        <SheetHeader className="mb-12 flex flex-row items-center space-x-2 space-y-0">
          <div className="space-x-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => previousTrace()}
                  disabled={index === 0}
                >
                  <FiChevronUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Previous Trace • <Kbd>K</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => nextTrace()}
                  disabled={index === props.data.length - 1}
                >
                  <FiChevronDown />
                </Button>
              </TooltipTrigger>

              <TooltipContent>
                Next Trace • <Kbd>J</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>

          <SheetTitle className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm">
            <code className="break-all px-1.5 text-left text-sm text-secondary-foreground">
              {traceId}
            </code>
            <CopyButton
              tooltip="Copy trace id"
              value={router.query.traceID?.toString() || ""}
            />
          </SheetTitle>

          <Spacer />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="hidden lg:flex"
                onClick={() =>
                  size === "default" ? setSize("full") : setSize("default")
                }
              >
                {size === "default" ? <SizeIcon /> : <ArrowRightIcon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {size === "default" ? "Full size" : "Collapse"} • <Kbd>F</Kbd>
            </TooltipContent>
          </Tooltip>
        </SheetHeader>
        {traceId && <TracePage />}
      </SheetContent>
    </Sheet>
  );
};

TracesPage.getLayout = (page) =>
  getGraphLayout(
    <GraphPageLayout
      title="Analytics"
      subtitle="Comprehensive view into Federated GraphQL Performance"
      toolbar={<AnalyticsToolbar tab="traces" />}
    >
      {page}
    </GraphPageLayout>,
    {
      title: "Analytics",
    },
  );

export default TracesPage;
